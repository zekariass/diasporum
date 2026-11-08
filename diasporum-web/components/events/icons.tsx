/** Minimal stroke icons in the Eventbrite style. */
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function base(props: P) {
  return {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const PinIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
);

export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const HeartIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 20.3 4.8 13a5.1 5.1 0 0 1 0-7.2 5 5 0 0 1 7.2 0l.6.6a5 5 0 0 1 7.8 6.6L12 20.3Z" />
  </svg>
);

export const HeartFilledIcon = (p: P) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M12 20.3 4.8 13a5.1 5.1 0 0 1 0-7.2 5 5 0 0 1 7.2 0l.6.6a5 5 0 0 1 7.8 6.6L12 20.3Z" />
  </svg>
);

export const ShareIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 15V4" />
    <path d="m7 8 5-5 5 5" />
    <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
  </svg>
);

export const CalendarIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M3 10h18" />
  </svg>
);

export const ClockIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

export const TicketIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
    <path d="M13 6v2M13 11v2M13 16v2" />
  </svg>
);

export const VideoIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="6" width="13" height="12" rx="2" />
    <path d="m16 10 5-3v10l-5-3" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const ArrowRightIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 12h16" />
    <path d="m14 6 6 6-6 6" />
  </svg>
);

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const FilterIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
);

export const XIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const RefundIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9a8 8 0 0 1 14.5-2M20 15a8 8 0 0 1-14.5 2" />
    <path d="M19 3v4h-4M5 21v-4h4" />
  </svg>
);

/* ---- Category rail icons (24px inside circles) ---- */

export const MusicIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 18V6l10-2v11" />
    <circle cx="7" cy="18" r="2.5" />
    <circle cx="17" cy="15" r="2.5" />
  </svg>
);

export const FoodIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M7 3v7a2 2 0 0 0 4 0V3M9 3v18" />
    <path d="M17 3c-1.7 0-3 2.2-3 5s1.3 4 3 4v9" />
  </svg>
);

export const ArtsIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 5h16v6a8 8 0 0 1-16 0V5Z" />
    <path d="M8 9h.01M16 9h.01M9 14c1 .8 2 1.2 3 1.2s2-.4 3-1.2" />
  </svg>
);

export const BusinessIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" />
  </svg>
);

export const CommunityIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9" r="2.4" />
    <path d="M15.5 19a6.9 6.9 0 0 1 5-6.6" />
  </svg>
);

export const SportsIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3c3 3 3 15 0 18M3.5 9h17M3.5 15h17" />
  </svg>
);

export const EducationIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m2.5 9 9.5-4 9.5 4-9.5 4-9.5-4Z" />
    <path d="M6 11.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5" />
    <path d="M21.5 9v5" />
  </svg>
);

export const CelebrationIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 21 4-9 9-4-4 9-9 4Z" />
    <path d="m14 6 1.5-3M19 9l3-1.5M18 14l2.5 2.5M8 15l-2.5 2.5" />
  </svg>
);
