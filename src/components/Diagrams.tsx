/** SVG chord diagrams: fretted chord boxes and a piano keyboard. */
import { isBlackKey } from '../music/piano';
import type { Voicing } from '../music/fretted';
import { noteName } from '../music/theory';

interface FretProps {
  voicing: Voicing;
  labels: string[];
  leftHanded?: boolean;
  capo?: number;
  title?: string;
}

export function FretDiagram({ voicing, labels, leftHanded, capo = 0, title }: FretProps) {
  const n = voicing.frets.length;
  const order = leftHanded ? [...Array(n).keys()].reverse() : [...Array(n).keys()];
  const fretted = voicing.frets.filter((f) => f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const minF = fretted.length ? Math.min(...fretted) : 0;
  const base = maxF <= 4 ? 1 : minF;
  const rows = Math.max(4, maxF - base + 1);
  const sx = n > 4 ? 26 : 34;
  const sy = 30;
  const left = 34;
  const top = 34;
  const width = left + sx * (n - 1) + 26;
  const height = top + sy * rows + 30;
  const x = (stringIdx: number) => left + order.indexOf(stringIdx) * sx;
  const y = (fret: number) => top + (fret - base + 0.5) * sy;
  const barre = voicing.barre;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width * 1.15} role="img" aria-label={title ?? 'Chord diagram'}>
      {title && <title>{title}</title>}
      {/* frets */}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line key={`f${i}`} x1={left} x2={left + sx * (n - 1)} y1={top + i * sy} y2={top + i * sy} stroke={i === 0 && base === 1 ? '#e8e8ee' : 'rgba(255,255,255,0.16)'} strokeWidth={i === 0 && base === 1 ? 4 : 1} strokeLinecap="round" />
      ))}
      {/* strings */}
      {voicing.frets.map((_, s) => (
        <line key={`s${s}`} x1={x(s)} x2={x(s)} y1={top} y2={top + rows * sy} stroke="rgba(255,255,255,0.28)" strokeWidth={1 + (n > 4 ? (n - 1 - s) * 0.18 : 0.3)} />
      ))}
      {base > 1 && <text x={left - 12} y={y(base) + 4} textAnchor="end" fontSize="11" fill="#9b9ba7">{base}fr</text>}
      {/* open / muted markers */}
      {voicing.frets.map((f, s) => f <= 0 && (
        f === 0
          ? <circle key={`o${s}`} cx={x(s)} cy={top - 14} r={5.5} fill="none" stroke="#9b9ba7" strokeWidth={1.5} />
          : <g key={`m${s}`} stroke="#62626e" strokeWidth={1.6} strokeLinecap="round"><line x1={x(s) - 4.5} x2={x(s) + 4.5} y1={top - 18.5} y2={top - 9.5} /><line x1={x(s) + 4.5} x2={x(s) - 4.5} y1={top - 18.5} y2={top - 9.5} /></g>
      ))}
      {barre && (
        <rect x={Math.min(x(barre.from), x(barre.to)) - 10} y={y(barre.fret) - 10} width={Math.abs(x(barre.to) - x(barre.from)) + 20} height={20} rx={10} fill="#8d44f6" />
      )}
      {voicing.frets.map((f, s) => f > 0 && !(barre && f === barre.fret && voicing.fingers[s] === 1 && s >= barre.from && s <= barre.to && s !== barre.from) && (
        <g key={`d${s}`}>
          <circle cx={x(s)} cy={y(f)} r={10} fill="#8d44f6" stroke="#a970ff" strokeWidth={1} />
          {voicing.fingers[s] > 0 && <text x={x(s)} y={y(f) + 4} textAnchor="middle" fontSize="11.5" fontWeight="600" fill="white">{voicing.fingers[s]}</text>}
        </g>
      ))}
      {/* string names */}
      {labels.map((l, s) => (
        <text key={`l${s}`} x={x(s)} y={top + rows * sy + 18} textAnchor="middle" fontSize="10.5" fill="#62626e">{l}</text>
      ))}
      {capo > 0 && <text x={left + (sx * (n - 1)) / 2} y={11} textAnchor="middle" fontSize="10.5" fill="#5fdcf3">capo {capo}</text>}
    </svg>
  );
}

interface PianoProps {
  right: number[];
  left: number[];
  from?: number;
  to?: number;
  flats?: boolean;
  onKey?: (midi: number) => void;
}

export function PianoKeyboard({ right, left, from: fromProp, to: toProp, flats = false, onKey }: PianoProps) {
  // Show two octaves around the voicing (three when the hands are spread), starting on a C.
  const notes = [...left, ...right];
  const lowest = notes.length ? Math.min(...notes) : 48;
  const highest = notes.length ? Math.max(...notes) : 71;
  const from = fromProp ?? Math.min(48, Math.floor(lowest / 12) * 12);
  const to = toProp ?? Math.max(from + 23, Math.ceil((highest + 1) / 12) * 12 - 1);
  const whites: number[] = [];
  for (let m = from; m <= to; m++) if (!isBlackKey(m)) whites.push(m);
  const ww = 24; const wh = 112; const bw = 15; const bh = 70;
  const width = whites.length * ww;
  const xOfWhite = (m: number) => whites.indexOf(m) * ww;
  const isR = (m: number) => right.includes(m);
  const isL = (m: number) => left.includes(m);
  const fill = (m: number, black: boolean) => (isR(m) ? '#8d44f6' : isL(m) ? '#22b4d2' : black ? '#1a1a1e' : '#ececf1');
  const label = (m: number) => noteName(m % 12, flats);
  return (
    <svg className="piano" viewBox={`-1 -1 ${width + 2} ${wh + 2}`} role="img" aria-label={`Piano: ${[...left, ...right].map(label).join(' ')}`}>
      {whites.map((m) => (
        <g key={m} onClick={() => onKey?.(m)} style={{ cursor: onKey ? 'pointer' : undefined }}>
          <rect x={xOfWhite(m)} y={0} width={ww - 1.5} height={wh} rx={4} fill={fill(m, false)} />
          {(isR(m) || isL(m)) && <text x={xOfWhite(m) + (ww - 1.5) / 2} y={wh - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="white">{label(m)}</text>}
          {m % 12 === 0 && !(isR(m) || isL(m)) && <text x={xOfWhite(m) + (ww - 1.5) / 2} y={wh - 10} textAnchor="middle" fontSize="9" fill="#9b9ba7">C{Math.floor(m / 12) - 1}</text>}
        </g>
      ))}
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).filter(isBlackKey).map((m) => {
        const x = xOfWhite(m - 1) + ww - bw / 2 - 0.75;
        return (
          <g key={m} onClick={() => onKey?.(m)} style={{ cursor: onKey ? 'pointer' : undefined }}>
            <rect x={x} y={0} width={bw} height={bh} rx={3} fill={fill(m, true)} stroke="#0b0b0d" strokeWidth={1} />
            {(isR(m) || isL(m)) && <text x={x + bw / 2} y={bh - 8} textAnchor="middle" fontSize="8.5" fontWeight="600" fill="white">{label(m)}</text>}
          </g>
        );
      })}
    </svg>
  );
}
