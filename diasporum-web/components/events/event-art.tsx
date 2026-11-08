/**
 * Deterministic cover art stand-in for event images.
 * Renders an abstract SVG "poster" per palette until real cover media
 * from the media module is wired in.
 */

const PALETTES: Record<number, { a: string; b: string; c: string; shape: string }> = {
  1: { a: "#3d1d53", b: "#b83280", c: "#f6ad55", shape: "#f05537" },
  2: { a: "#7b341e", b: "#dd6b20", c: "#fbd38d", shape: "#faf089" },
  3: { a: "#1a365d", b: "#d53f8c", c: "#f687b3", shape: "#fbbf24" },
  4: { a: "#1c3d5a", b: "#2b6cb0", c: "#63b3ed", shape: "#9ae6b4" },
  5: { a: "#285e61", b: "#319795", c: "#81e6d9", shape: "#f6e05e" },
  6: { a: "#44337a", b: "#6b46c1", c: "#b794f4", shape: "#f687b3" },
  7: { a: "#742a2a", b: "#c53030", c: "#fc8181", shape: "#fbd38d" },
  8: { a: "#22543d", b: "#2f855a", c: "#9ae6b4", shape: "#faf089" },
};

export function EventArt({
  palette,
  className = "",
  decorative = false,
}: {
  palette: number;
  className?: string;
  decorative?: boolean;
}) {
  const p = PALETTES[((palette - 1) % 8) + 1];
  const id = `g${palette}`;
  return (
    <svg
      className={className}
      viewBox="0 0 800 450"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden={decorative}
      role={decorative ? undefined : "img"}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.a} />
          <stop offset="55%" stopColor={p.b} />
          <stop offset="100%" stopColor={p.c} />
        </linearGradient>
      </defs>
      <rect width="800" height="450" fill={`url(#${id})`} />
      <circle cx="640" cy="90" r="150" fill={p.shape} opacity="0.28" />
      <circle cx="120" cy="380" r="190" fill={p.c} opacity="0.22" />
      <path d="M-40 320 Q 200 180 400 300 T 840 260 V450 H-40 Z" fill={p.a} opacity="0.35" />
      <path d="M-40 380 Q 220 260 460 360 T 840 330 V450 H-40 Z" fill={p.shape} opacity="0.18" />
      <circle cx="300" cy="140" r="46" fill={p.c} opacity="0.5" />
      <circle cx="300" cy="140" r="70" fill="none" stroke={p.c} strokeWidth="3" opacity="0.4" />
    </svg>
  );
}
