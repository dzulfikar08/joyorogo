/**
 * The Android robot's head, drawn as a plain monochrome glyph (currentColor). Not the "Get it on Google Play" badge.
 * The robot is reproduced or modified from work created and shared by Google under the Creative Commons 3.0
 * Attribution License; the footers carry ANDROID_ROBOT_CREDIT (src/lib/credits.ts).
 */
export function AndroidMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={className}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M3 18a9 9 0 0 1 18 0ZM7.4 14.2a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0ZM14.4 14.2a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="m7.2 4.8 2 3.4m7.6-3.4-2 3.4"
      />
    </svg>
  );
}
