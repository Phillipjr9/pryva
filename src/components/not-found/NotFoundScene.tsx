/**
 * The 404 cartoon: a small astronaut who has drifted off the map, bobbing in a
 * lavender sky while the digits of 404 float around them like lost balloons.
 *
 * It is hand-drawn vector, not a video file, and that is deliberate:
 *   • no decode, no autoplay permission, no poster frame — it starts on the
 *     first paint and loops forever;
 *   • sharp at every size and a few kilobytes of markup instead of megabytes;
 *   • every moving part is a CSS transform, so the global
 *     `prefers-reduced-motion` rule in globals.css stops it dead for anyone who
 *     asked for that.
 *
 * Decorative, so the whole scene is `aria-hidden`: the words beside it carry the
 * meaning, and a screen reader should not walk a doodle.
 */

/** Fixed star positions with staggered twinkle delays — no randomness, so the
 *  server and client render the same sky. */
const STARS: Array<[number, number, number, number]> = [
  [38, 52, 2.4, 0], [104, 96, 1.8, 700], [172, 48, 2.2, 1400], [238, 92, 1.6, 300],
  [296, 40, 2, 2100], [402, 60, 1.8, 900], [466, 36, 2.4, 1800], [520, 74, 1.6, 500],
  [584, 34, 2.2, 1200], [664, 96, 1.8, 2500], [700, 44, 2.4, 1600],
  [60, 214, 1.8, 1100], [22, 300, 2.2, 400], [110, 356, 1.6, 2200],
  [214, 330, 1.8, 1500], [270, 372, 2, 800], [452, 344, 1.8, 1900],
  [520, 376, 2.2, 600], [610, 314, 1.6, 2400], [676, 246, 2, 1300], [700, 348, 1.8, 1000],
];

/** A few four-point sparkles for the sky's bigger twinkles. */
const SPARKLES: Array<[number, number, number, number]> = [
  [148, 96, 9, 400], [430, 106, 7, 1900], [640, 168, 10, 1100], [88, 260, 7, 1600],
];

export function NotFoundScene() {
  return (
    <div aria-hidden="true" className="relative w-full select-none">
      <svg viewBox="0 0 720 400" role="presentation" className="block h-auto w-full">
        <defs>
          <linearGradient id="nf-sky" x1="0" y1="0" x2="0.3" y2="1">
            <stop offset="0" stopColor="#f1e9fe" />
            <stop offset="0.52" stopColor="#faf6ff" />
            <stop offset="1" stopColor="#fff2e6" />
          </linearGradient>
          <radialGradient id="nf-glow" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#cdbaf0" stopOpacity="0.55" />
            <stop offset="1" stopColor="#cdbaf0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="nf-body" x1="0.1" y1="0" x2="0.7" y2="1">
            <stop offset="0" stopColor="#a58ce2" />
            <stop offset="1" stopColor="#6b4fae" />
          </linearGradient>
          <linearGradient id="nf-helmet" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#e7ddf7" />
          </linearGradient>
          <linearGradient id="nf-visor" x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#3d3259" />
            <stop offset="1" stopColor="#211b31" />
          </linearGradient>
          <linearGradient id="nf-moon" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0" stopColor="#fff9ef" />
            <stop offset="1" stopColor="#f3d9b8" />
          </linearGradient>
          <linearGradient id="nf-shell" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#fffdfa" />
            <stop offset="1" stopColor="#e3d8f5" />
          </linearGradient>
          <filter id="nf-soft" x="-0.4" y="-0.4" width="1.8" height="1.8">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>

        {/* Sky and the soft lavender bloom the astronaut floats in. */}
        <rect width="720" height="400" fill="url(#nf-sky)" />
        <ellipse cx="352" cy="212" rx="268" ry="196" fill="url(#nf-glow)" />

        {/* Stars and sparkles. */}
        <g>
          {STARS.map(([x, y, r, delay]) => (
            <g key={`${x}-${y}`} className="nf-twinkle" style={{ animationDelay: `${delay}ms` }}>
              <circle cx={x} cy={y} r={r} fill="#b49ce7" />
            </g>
          ))}
          {SPARKLES.map(([x, y, size, delay]) => (
            <g key={`s-${x}-${y}`} className="nf-twinkle" style={{ animationDelay: `${delay}ms`, animationDuration: "4.6s" }}>
              <path
                d={`M${x} ${y - size} Q ${x} ${y} ${x + size} ${y} Q ${x} ${y} ${x} ${y + size} Q ${x} ${y} ${x - size} ${y} Q ${x} ${y} ${x} ${y - size} Z`}
                fill="#cdbaf0"
              />
            </g>
          ))}
        </g>

        {/* Moon, top right, breathing behind the scene. */}
        <g>
          <circle cx="642" cy="58" r="86" fill="#f7e6c9" opacity="0.22" className="nf-halo" />
          <circle cx="642" cy="58" r="52" fill="url(#nf-moon)" />
          <ellipse cx="626" cy="36" rx="11" ry="8" fill="#e8cba4" opacity="0.5" />
          <ellipse cx="665" cy="52" rx="7" ry="6" fill="#e8cba4" opacity="0.42" />
          <ellipse cx="648" cy="80" rx="13" ry="6" fill="#e8cba4" opacity="0.36" />
        </g>

        {/* A little ringed planet, drifting. */}
        <g className="nf-bob" style={{ animationDuration: "9s", animationDelay: "-2s" }}>
          <circle cx="120" cy="182" r="24" fill="#cdbaf0" />
          <circle cx="112" cy="174" r="7" fill="#b49ce7" opacity="0.7" />
          <ellipse
            cx="120"
            cy="182"
            rx="44"
            ry="11"
            fill="none"
            stroke="#e1d5f7"
            strokeWidth="6"
            transform="rotate(-18 120 182)"
          />
        </g>

        {/* The rocket that crosses the sky every so often. */}
        <g transform="translate(0 46)">
          <g className="nf-rocket">
            <path d="M0 -7 Q -30 0 0 7 Z" fill="#f6b48a" opacity="0.9" />
            <path className="nf-flame" d="M-8 -4 Q -22 0 -8 4 Z" fill="#fbd3b4" />
            <rect x="0" y="-12" width="54" height="24" rx="12" fill="url(#nf-shell)" stroke="#e1d5f7" strokeWidth="2" />
            <path d="M52 -12 Q 76 0 52 12 Z" fill="#cdbaf0" />
            <path d="M8 -12 L -6 -27 L 18 -13 Z" fill="#b49ce7" />
            <path d="M8 12 L -6 27 L 18 13 Z" fill="#b49ce7" />
            <circle cx="30" cy="0" r="7.5" fill="#2f2745" />
            <circle cx="27" cy="-3" r="2.6" fill="#ffffff" opacity="0.65" />
          </g>
        </g>

        {/* A dashed tether, drifting outward from the astronaut. */}
        <path
          d="M296 148 C 244 112 196 122 138 88 C 112 72 96 62 78 52"
          fill="none"
          stroke="#cdbaf0"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="6 12"
          className="nf-trail"
        />

        {/* Clouds at the bottom edge, drifting sideways. */}
        <g fill="#ffffff" opacity="0.75" filter="url(#nf-soft)">
          <ellipse cx="120" cy="356" rx="104" ry="30" className="nf-drift" />
          <ellipse cx="370" cy="380" rx="150" ry="34" className="nf-drift" style={{ animationDelay: "-6s" }} />
          <ellipse cx="618" cy="358" rx="92" ry="28" className="nf-drift" style={{ animationDelay: "-11s" }} />
          <ellipse cx="248" cy="392" rx="120" ry="26" className="nf-drift" style={{ animationDelay: "-3s" }} />
          <ellipse cx="516" cy="396" rx="110" ry="24" className="nf-drift" style={{ animationDelay: "-8s" }} />
        </g>

        {/* The astronaut's own shadow, which stays put while they bob. */}
        <ellipse cx="330" cy="356" rx="94" ry="12" fill="#6b4fae" opacity="0.12" filter="url(#nf-soft)" />

        {/* The astronaut. */}
        <g className="nf-bob" style={{ transformBox: "view-box", transformOrigin: "330px 250px" }}>
          {/* Backpack, then arms, so both sit behind the body. */}
          <rect x="292" y="214" width="76" height="94" rx="28" fill="#4f3b83" />
          <rect x="300" y="228" width="14" height="38" rx="7" fill="#3d2f66" opacity="0.6" />

          <g className="nf-wave">
            <rect x="382" y="238" width="16" height="54" rx="8" fill="#8266c9" />
            <circle cx="390" cy="296" r="11" fill="#fff6e8" />
          </g>
          <g transform="rotate(-14 270 244)">
            <rect x="262" y="238" width="16" height="54" rx="8" fill="#8266c9" />
            <circle cx="261" cy="296" r="11" fill="#fff6e8" />
          </g>

          {/* Dangling legs. */}
          <rect x="306" y="308" width="18" height="46" rx="9" fill="#4f3b83" />
          <ellipse cx="315" cy="354" rx="13" ry="8" fill="#3d2f66" />
          <rect x="340" y="308" width="18" height="46" rx="9" fill="#4f3b83" />
          <ellipse cx="349" cy="354" rx="13" ry="8" fill="#3d2f66" />

          {/* Body. */}
          <ellipse cx="330" cy="262" rx="60" ry="62" fill="url(#nf-body)" />
          <ellipse cx="310" cy="242" rx="16" ry="24" fill="#ffffff" opacity="0.16" transform="rotate(-18 310 242)" />
          <circle cx="330" cy="280" r="8" fill="#f6b48a" />
          <circle cx="330" cy="280" r="8" fill="none" stroke="#4f3b83" strokeWidth="2" opacity="0.25" />
          <circle cx="327" cy="277" r="2.6" fill="#ffffff" opacity="0.7" />
          <rect x="298" y="300" width="64" height="6" rx="3" fill="#4f3b83" opacity="0.18" />

          {/* Antenna, with a glow that pulses. */}
          <line x1="330" y1="134" x2="330" y2="112" stroke="#cdbaf0" strokeWidth="3" strokeLinecap="round" />
          <circle cx="330" cy="106" r="12" fill="#f2a97c" opacity="0.3" className="nf-halo" />
          <circle cx="330" cy="106" r="5.5" fill="#f2a97c" />

          {/* Helmet and visor. */}
          <circle cx="330" cy="190" r="56" fill="url(#nf-helmet)" stroke="#d8c9f2" strokeWidth="3" />
          <ellipse cx="330" cy="196" rx="40" ry="36" fill="url(#nf-visor)" />
          <path d="M302 174 Q 330 160 358 172" fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" opacity="0.28" />
          <path d="M304 214 Q 320 224 330 218" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" opacity="0.12" />

          {/* Eyes that blink, and a small, game smile. */}
          <g className="nf-blink">
            <ellipse cx="316" cy="194" rx="5.5" ry="7" fill="#f7f3fd" />
            <ellipse cx="344" cy="194" rx="5.5" ry="7" fill="#f7f3fd" />
          </g>
          <path d="M318 212 Q 330 222 342 212" fill="none" stroke="#f7f3fd" strokeWidth="3.4" strokeLinecap="round" opacity="0.85" />
        </g>

        {/* 404, as three balloons that never quite settle. */}
        <g className="nf-bob" style={{ animationDuration: "6.6s", animationDelay: "-0.6s" }}>
          <g transform="rotate(-7 470 128)">
            <rect x="436" y="94" width="68" height="68" rx="22" fill="#fbe6d4" />
            <rect x="436" y="94" width="68" height="68" rx="22" fill="#ffffff" opacity="0.35" />
            <text x="470" y="130" textAnchor="middle" dominantBaseline="central" fontSize="38" fontWeight="700" fill="#6b4fae" fontFamily="var(--font-sans)">
              4
            </text>
          </g>
        </g>
        <g className="nf-bob" style={{ animationDuration: "7.8s", animationDelay: "-2.4s" }}>
          <g transform="rotate(6 552 196)">
            <rect x="522" y="166" width="60" height="60" rx="20" fill="#e4efe6" />
            <rect x="522" y="166" width="60" height="60" rx="20" fill="#ffffff" opacity="0.35" />
            <text x="552" y="198" textAnchor="middle" dominantBaseline="central" fontSize="34" fontWeight="700" fill="#4f3b83" fontFamily="var(--font-sans)">
              0
            </text>
          </g>
        </g>
        <g className="nf-bob" style={{ animationDuration: "8.4s", animationDelay: "-4.2s" }}>
          <g transform="rotate(-4 486 296)">
            <rect x="460" y="270" width="52" height="52" rx="18" fill="#efe7fb" />
            <text x="486" y="298" textAnchor="middle" dominantBaseline="central" fontSize="30" fontWeight="700" fill="#6b4fae" fontFamily="var(--font-sans)">
              4
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
