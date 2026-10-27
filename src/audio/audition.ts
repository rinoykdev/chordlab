/** A small synth for hearing a voicing: strummed for fretted instruments, block chord for piano. */
let ctx: AudioContext | null = null;

function context(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function pluck(ac: AudioContext, out: AudioNode, midi: number, when: number, kind: 'pluck' | 'piano') {
  const f = 440 * 2 ** ((midi - 69) / 12);
  const g = ac.createGain();
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(kind === 'pluck' ? 4200 : 2600, when);
  lp.frequency.exponentialRampToValueAtTime(900, when + 1.2);
  const decay = kind === 'pluck' ? 1.6 : 2.4;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.22, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  lp.connect(g).connect(out);
  const partials: [OscillatorType, number, number][] = kind === 'pluck' ? [['sawtooth', 1, 0.5], ['triangle', 2, 0.25]] : [['triangle', 1, 0.7], ['sine', 2, 0.2], ['sine', 3, 0.08]];
  for (const [type, mult, amp] of partials) {
    const o = ac.createOscillator();
    const og = ac.createGain();
    o.type = type;
    o.frequency.value = f * mult;
    og.gain.value = amp;
    o.connect(og).connect(lp);
    o.start(when);
    o.stop(when + decay + 0.05);
  }
}

export function auditionNotes(midis: number[], style: 'strum' | 'block' = 'strum'): void {
  if (!midis.length) return;
  const ac = context();
  const master = ac.createGain();
  master.gain.value = 0.7 / Math.sqrt(midis.length);
  master.connect(ac.destination);
  const t0 = ac.currentTime + 0.02;
  midis.forEach((m, i) => pluck(ac, master, m, t0 + (style === 'strum' ? i * 0.035 : 0), style === 'strum' ? 'pluck' : 'piano'));
}
