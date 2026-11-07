import { DISCORD_LOGO_PATH, DISCORD_LOGO_VIEWBOX } from "@/lib/discord";

/** Discord's logo as a monochrome glyph (currentColor) for links to the server; source in lib/discord.ts. */
export function DiscordMark({ className }: { className?: string }) {
  return (
    <svg viewBox={DISCORD_LOGO_VIEWBOX} aria-hidden="true" focusable="false" className={className}>
      <path fill="currentColor" d={DISCORD_LOGO_PATH} />
    </svg>
  );
}
