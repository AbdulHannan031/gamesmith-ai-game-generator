/** One stroke weight, one corner style — a single icon voice across the app. */

interface P {
  className?: string;
}

const base = "h-4 w-4";
const strokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const IconPlay = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path d="M5 3.4v9.2a.6.6 0 0 0 .92.5l7.2-4.6a.6.6 0 0 0 0-1L5.92 2.9A.6.6 0 0 0 5 3.4Z" fill="currentColor" />
  </svg>
);

export const IconRestart = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="M13.5 8a5.5 5.5 0 1 1-1.9-4.15" />
    <path {...strokeProps} d="M13.6 1.9v3.2h-3.2" />
  </svg>
);

export const IconSend = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="M14 2 7.2 8.8M14 2l-4.4 12-2.4-5.2L2 6.4 14 2Z" />
  </svg>
);

export const IconStop = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
  </svg>
);

export const IconGlobe = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <circle cx="8" cy="8" r="6" {...strokeProps} />
    <path {...strokeProps} d="M2 8h12M8 2c1.7 1.9 2.6 4 2.6 6S9.7 12.1 8 14C6.3 12.1 5.4 10 5.4 8S6.3 3.9 8 2Z" />
  </svg>
);

export const IconLock = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <rect x="3.2" y="7" width="9.6" height="6.5" rx="1.8" {...strokeProps} />
    <path {...strokeProps} d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" />
  </svg>
);

export const IconHeart = ({ className = base, filled = false }: P & { filled?: boolean }) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path
      {...strokeProps}
      fill={filled ? "currentColor" : "none"}
      d="M8 13.4S2.5 10.3 2.5 6.6A2.9 2.9 0 0 1 8 5.2a2.9 2.9 0 0 1 5.5 1.4c0 3.7-5.5 6.8-5.5 6.8Z"
    />
  </svg>
);

export const IconFile = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="M9 1.8H4.6a1.4 1.4 0 0 0-1.4 1.4v9.6a1.4 1.4 0 0 0 1.4 1.4h6.8a1.4 1.4 0 0 0 1.4-1.4V5.6L9 1.8Z" />
    <path {...strokeProps} d="M9 1.8v3.8h3.8" />
  </svg>
);

export const IconPlus = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="M8 3.4v9.2M3.4 8h9.2" />
  </svg>
);

export const IconChevron = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="m6 3.6 4.4 4.4L6 12.4" />
  </svg>
);

export const IconWarn = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="M8 2.6 1.9 13.2h12.2L8 2.6Z" />
    <path {...strokeProps} d="M8 6.6v3M8 11.4h.01" />
  </svg>
);

export const IconRemix = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="M2 4.4h2.6c3.4 0 4.4 7.2 7.8 7.2H14" />
    <path {...strokeProps} d="M2 11.6h2.6c1.4 0 2.3-1.2 3-2.7M11.6 9.9 14 11.6l-2.4 1.7M11.6 2.7 14 4.4l-2.4 1.7" />
  </svg>
);

export const IconTrash = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="M2.8 4.4h10.4M6.4 4.4V3.2a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.2M4.2 4.4l.6 8.2a1.2 1.2 0 0 0 1.2 1.1h4a1.2 1.2 0 0 0 1.2-1.1l.6-8.2" />
  </svg>
);

export const IconCamera = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <rect x="1.8" y="4.4" width="12.4" height="9" rx="1.8" {...strokeProps} />
    <circle cx="8" cy="8.9" r="2.4" {...strokeProps} />
    <path {...strokeProps} d="M5.6 4.4 6.6 2.6h2.8l1 1.8" />
  </svg>
);

export const IconSpark = ({ className = base }: P) => (
  <svg viewBox="0 0 16 16" className={className} aria-hidden>
    <path {...strokeProps} d="M8 1.6 9.5 6 14 7.5 9.5 9 8 13.4 6.5 9 2 7.5 6.5 6 8 1.6Z" />
  </svg>
);
