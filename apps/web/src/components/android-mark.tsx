import { ANDROID_ROBOT_PATH, ANDROID_ROBOT_VIEWBOX } from "@/lib/android-robot";

/**
 * The official Android robot head as a monochrome glyph (currentColor), not the "Get it on Google Play" badge. The
 * artwork, its source and its licence terms are documented in lib/android-robot.ts; the footers carry the required
 * attribution (ANDROID_ROBOT_CREDIT in lib/credits.ts).
 */
export function AndroidMark({ className }: { className?: string }) {
  return (
    <svg viewBox={ANDROID_ROBOT_VIEWBOX} aria-hidden="true" focusable="false" className={className}>
      <path fill="currentColor" fillRule="evenodd" d={ANDROID_ROBOT_PATH} />
    </svg>
  );
}
