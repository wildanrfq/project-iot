export function GaugeMark({ className = '' }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M7 8h4M7 12h6M7 16h3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
      <path
        d="M15.5 7v10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
      <path
        d="M13.5 14l2 3 2-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function RefreshGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.45-3.72"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="square"
      />
      <path
        d="M13.5 2.5v3h-3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function PauseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="3" height="10" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" fill="currentColor" />
    </svg>
  );
}

export function PlayGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 3L13 8l-8.5 5V3z" fill="currentColor" />
    </svg>
  );
}

export function SlidersGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
      />
      <rect x="4.5" y="3" width="2.5" height="3" fill="currentColor" />
      <rect x="9.5" y="6.5" width="2.5" height="3" fill="currentColor" />
      <rect x="5.5" y="10" width="2.5" height="3" fill="currentColor" />
    </svg>
  );
}

export function SunGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function MoonGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M12.8 9.8A5.2 5.2 0 0 1 6.2 3.2a5.3 5.3 0 1 0 6.6 6.6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function GpsPinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
      />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function SoundWaveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 6.2v3.6h2.6L9 12.5V3.5L5.6 6.2H3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />
      <path
        d="M11.4 5.5a3.5 3.5 0 0 1 0 5M13.3 3.8a6 6 0 0 1 0 8.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function TelegramMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M14 2.5L2 7.2l4.1 1.5 1.7 4.3 2.3-2.5 2.7 2L14 2.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />
      <path d="M6.1 8.7L13.5 3" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3.5 3.5l9 9M12.5 3.5l-9 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function AlarmBellGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.5 10.5V6.8a3.5 3.5 0 0 1 7 0v3.7l1.2 1.5H3.3l1.2-1.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="miter"
      />
      <path d="M6.5 12.2a1.5 1.5 0 0 0 3 0" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2 5.2L3.2 6.4M14 5.2l-1.2 1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
    </svg>
  );
}

export function TrophyTargetGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

export function MapRadarGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4l3.5-1.5L10 4l3.5-1.5v9.5L10 13.5 6 12l-3.5 1.5V4z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />
      <path d="M6 2.5V12M10 4v9.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

