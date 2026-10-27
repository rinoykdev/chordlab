# Chordlab

An offline-first PWA that detects the chords in a song on your device and shows how to play them on
guitar, ukulele or piano. Audio never leaves the browser: there is no backend, account or remote API.

```bash
npm install
npm run dev        # development server
npm run build      # type-check + production build into dist/ (includes the service worker)
npm run preview    # serve the production build (offline mode only works in this build)
npm run build:single  # one self-contained index.html for hosted previews (no offline install)
npm test           # 70 unit tests, synthetic audio included
npm run eval:real -- eval/real   # score real recordings you supply (see eval/real/README.md)
```

Deploy `dist/` to any static host. It uses relative paths, so a sub-folder works too.
Service workers need HTTPS (or `localhost`). Never publish the repository root itself: its `index.html`
points at TypeScript source, which browsers can't run, so the page stays blank.

**GitHub Pages:** `.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push to
`main`. One-time setup: Settings → Pages → Build and deployment → Source → **GitHub Actions**.

## How it works

```
file ─► decode (Web Audio, 11 025 Hz mono) ─► Web Worker ─────────────────────────────────┐
         waveform peaks                         features.ts   STFT 4096/512, tuning estimate,
                                                              whitened log spectrum → treble +
                                                              bass chroma, median filter, onsets
                                                recognizer    harmonic chord templates (cosine)
                                                decode.ts     Viterbi HMM (switch penalty),
                                                              short-segment absorption,
                                                              posteriors → confidence, alternatives
                                                key.ts        Krumhansl profiles + chord evidence
                                                tempo.ts      onset autocorrelation, metrical comb
                                                              ◄────────────────────────────────┘
results + cached features ─► IndexedDB ─► timeline / diagrams (music/*: deterministic mapping)
```

| Folder | Responsibility |
|---|---|
| `src/engine/` | DSP pipeline; no DOM or React, so it runs in the worker, on the main thread and in Node tests |
| `src/engine/recognizers/` | `ChordRecognizer` interface plus the default template matcher |
| `src/music/` | Chord parsing, key-aware spelling, transposition, guitar/ukulele voicings, piano voicings, capo suggestion |
| `src/state/` | Project model, pure editing operations, IndexedDB, app store |
| `src/audio/` | Decoding, pitch-preserving playback with looping, voicing audition synth |
| `src/components/` | UI: library, preview, inspector, timeline, SVG diagrams |

**Re-analysis is instant.** Chroma features are cached in IndexedDB, so changing smoothing, shortest
chord length or chord types re-runs only the decoding stages, without touching the audio again.

**Adding a model later.** Implement `ChordRecognizer.frameScores()` (it receives features and,
optionally, raw audio) and return per-frame scores over the vocabulary. The HMM, segmentation, key,
tempo, UI and storage stay as they are. Model weights can be precached by adding them to
`PUBLIC_FILES` in `vite.config.ts`, or stored in IndexedDB on first download; both count toward the
browser's storage quota, so check `navigator.storage.estimate()` first.

**Restricted hosts.** If a host's security policy blocks Web Workers, analysis runs on the main thread
instead (the worker must answer a handshake before it receives audio). If blob media is blocked or the
`<audio>` element can't play a file, playback switches to Web Audio, where changing speed also
changes pitch. Both paths are tested under a strict content-security policy.

**Teach Chordlab (learning from your guitar).** The graduation-cap icon opens a recording session:
the app asks for one chord at a time, records about three seconds from the microphone (voice
processing off), and checks each take against the requested chord using the theoretical templates,
so a wrong chord is flagged ("That sounded more like Am than G") instead of polluting the training.
Takes can also be imported from audio files. Each take becomes one root-relative chroma vector;
averaging per chord type gives a template valid in all 12 keys, blended with theory by
n / (n + 2) so a few takes nudge rather than override. Results are measured leave-one-out
(each take judged by a profile built from the others) against the default engine. With the profile
switched on, analysis uses the learned templates and can detect the chord types you taught
(e.g. sus2, sus4, dim, add9, power chords). Code: `src/engine/learn.ts`, `src/state/teach.ts`,
`src/audio/recorder.ts`, `src/components/Teach.tsx`. Takes are stored in IndexedDB (`takes`).

**Instrument shapes** come from three tiers, in order: hand-checked open shapes (standard tuning),
standard movable E-shape/A-shape barre chords, then a search over the fretboard that finds every
playable shape (span of four frets or less, at most four fingers, root in the bass on guitar). The
search is what makes alternate tunings (drop D, open G, DADGAD, half-step down, low-G or baritone
ukulele) work for every chord.

## Test results

**Synthetic audio (`tests/engine.test.ts`, 43 tests).** Chords are synthesised with real harmonic
content. The tests cover all 24 triads, pure sines, inversions, drums, white noise at 10% of peak,
±40 cent detuning, melodies with passing tones, silence, noise-only input, ambiguous chords, 7th
chords, and a 5-minute file. Major/minor detection labels 90–100% of the time correctly in every
case. With the beta sevenths vocabulary it reaches about 87% (Fmaj7 tends to read as F). Key
detection is correct on all five test progressions. Tempo is within 3% across 66–174 BPM *up to a
factor of two*: slow tempos can read as double, so the UI offers ×2 / ÷2. A 5-minute recording
analyses in about 8 s in Node, and runs in a worker in the browser.

**Learning (`tests/learn.test.ts`, 7 tests).** Wrong takes are flagged, a profile learned from G and A
sus4 finds Dsus4 and Esus4 in an unseen song, and major/minor detection doesn't degrade.
`tests/e2e/teach-flow.py` drives the full session in Chromium with a fake microphone (9 checks).

**Mapping and editing (`tests/music.test.ts`, `tests/project.test.ts`).** Every curated shape plays
exactly its chord. Every chord in every tuning gets a playable shape. Piano voicings contain the right
notes. Transposition round-trips for all chords. Chord editing operations keep segments contiguous.

**Browser end to end (`tests/e2e/flow.py`, 26 checks, headless Chromium, production build).** The
script imports an MP3 and matches the exact known progression, key and tempo. It checks that
playback, seeking and the 0.75× speed stay in sync, that switching instruments and transposing
update the diagrams, that root-picker and typed corrections work along with undo, split and loop,
and that edits survive a reload. It confirms non-audio and corrupted files are rejected with a
clear message. Offline, it checks that the app loads, saved projects reopen, and a new OGG file is
analysed. It also checks a 390 px mobile layout. To run it: `npx vite preview --port 4173`, then
`npx tsx tests/e2e/make-audio.ts`, convert to MP3 and OGG with ffmpeg, and
`python3 tests/e2e/flow.py` (requires Playwright for Python). The app also has a built-in self-test
(flask icon) that runs the same synthetic checks in your browser.

**Real recordings have not been evaluated yet.** No licensed recordings with ground-truth
annotations were available while building this. Use `npm run eval:real` with your own WAV files and
`.lab` annotations to measure it. Synthetic results show the engine works as designed; they do not
predict accuracy on produced music.

## Known limitations

- **Full-band recordings are much harder than the tests.** Template matching on chroma typically
  scores roughly 60–75% (major/minor) on produced pop and rock in published evaluations, against
  80%+ for modern neural models. Distorted guitars, heavy reverb, vocals carrying the harmony,
  sparse arrangements (a bass line implying chords) and borrowed or passing chords all cause errors.
  Expect confusion between relative chords (C and Am, which share two notes) and between a chord and
  its 7th or sus version. Dashed chords with a "?" are below 55% confidence; check them by ear.
- **Vocabulary:** only major and minor are detected by default. Sevenths are beta. Diminished,
  augmented, sus, slash chords and inversions can be entered manually but aren't detected.
- **Tempo** assumes a steady beat and can be off by a factor of two. Songs with tempo changes report
  one average value.
- **Key** is a single global estimate. Modulations are not tracked.
- **Memory:** browsers decode the whole file before analysis. Files over 300 MB or 60 minutes are
  refused. Recordings over 15 minutes trigger a warning, and phones may run out of memory sooner;
  that case is reported as an error rather than a frozen tab.
- **Formats** are whatever the browser decodes (MP3, WAV, AAC/M4A, OGG/Opus, FLAC in current
  Chromium, Firefox and Safari). Safari can't decode OGG Vorbis.
- **Storage** is browser-managed. The app requests persistent storage, but if the browser declines,
  projects can be cleared under storage pressure. The library footer shows usage.
- Melody/note transcription has a reserved track but no implementation.
