# Real-recording evaluation

Put pairs of `name.wav` and `name.lab` here, then run `npm run eval:real`.
Recordings and annotations are not included, because commercial audio cannot be redistributed.

`.lab` files use the MIREX / Harte format, one chord per line: `start end label`, for example
`12.30 14.10 A:min7` or `0.00 1.20 N`. Public annotation sets in this format include the Isophonics
Beatles/Queen annotations, McGill Billboard and RWC Pop. You supply the matching audio yourself.

Convert other audio with `ffmpeg -i song.mp3 -ac 1 song.wav`.
Scores follow MIREX "majmin": references reduce to major/minor/N and other chord types are excluded.
These results are kept separate from the synthetic tests in `tests/`, which only show the engine
works as designed on clean signals.
