import { APPLE_LOGO_PATH, APPLE_LOGO_VIEWBOX } from "@/lib/apple-logo";

/** The Apple logo as a monochrome glyph (currentColor) for iPhone links; source in lib/apple-logo.ts. */
export function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox={APPLE_LOGO_VIEWBOX} aria-hidden="true" focusable="false" className={className}>
      <path fill="currentColor" d={APPLE_LOGO_PATH} />
    </svg>
  );
}
