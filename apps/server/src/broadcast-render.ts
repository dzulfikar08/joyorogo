/**
 * Announcement mail rendering: a small markdown subset in, an HTML part and a
 * text part out. No images, no tracking pixels, no remote assets.
 *
 * Source syntax (one line = one line of the text part):
 * - blank line starts a new paragraph; other lines of a paragraph stay on their own line (`<br>`)
 * - `- item` lines form a bullet list
 * - `**bold**`, `[label](https://url)`, and bare `https://url` (made a link)
 * - `{nama}` is the recipient's first name ("kamu" when unknown; "there" in an English mail)
 */

export type Campaign = { id: string; subject: string; body: string };

export type RenderedMail = { subject: string; html: string; text: string };

export const FALLBACK_NAME = "kamu";

/** Footer wording and the unknown-name fallback per mail language; the body is written per language by the caller. */
const LOCALE_COPY: Record<"id" | "en", { fallbackName: string; unsubscribe: string; unsubscribeLink: string }> = {
  id: { fallbackName: FALLBACK_NAME, unsubscribe: "Tidak mau terima email seperti ini lagi?", unsubscribeLink: "Berhenti berlangganan" },
  en: { fallbackName: "there", unsubscribe: "Don't want emails like this anymore?", unsubscribeLink: "Unsubscribe" },
};

/** Text-node escaping; the URL patterns below stop at `"`, so a matched URL is attribute-safe too. */
const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** "Siti Aminah" -> "Siti"; "dzul" -> "Dzul"; an email address or blank -> `fallback` ("kamu"). */
export function firstName(fullName: string | null | undefined, fallback = FALLBACK_NAME): string {
  const word = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!word || word.includes("@") || !/\p{L}/u.test(word)) return fallback;
  const uniform = word === word.toLowerCase() || word === word.toUpperCase();
  return uniform ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

// [label](url) | **bold** | bare url
const INLINE_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)"]+)\)|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<"]+)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)]+$/;

/** A bare URL without the sentence punctuation stuck to its end. */
function splitUrl(raw: string): { url: string; rest: string } {
  const rest = raw.match(TRAILING_PUNCTUATION_RE)?.[0] ?? "";
  return { url: raw.slice(0, raw.length - rest.length), rest };
}

/** One source line to HTML. `{nama}` stays literal until the very end, so a name can never become markup. */
function lineToHtml(line: string, name: string): string {
  const html = escapeHtml(line).replace(
    INLINE_RE,
    (_match, label?: string, href?: string, bold?: string, bare?: string) => {
      if (label !== undefined && href !== undefined) return `<a href="${href}" style="${LINK_STYLE}">${label}</a>`;
      if (bold !== undefined) return `<strong>${bold}</strong>`;
      const { url, rest } = splitUrl(bare ?? "");
      return `<a href="${url}" style="${LINK_STYLE}">${url}</a>${rest}`;
    },
  );
  return html.replaceAll("{nama}", escapeHtml(name));
}

function lineToText(line: string, name: string): string {
  return line
    .replace(INLINE_RE, (_match, label?: string, href?: string, bold?: string, bare?: string) => {
      if (label !== undefined && href !== undefined) return `${label} (${href})`;
      return bold ?? bare ?? "";
    })
    .replaceAll("{nama}", name);
}

const INK = "#1f2937";
const MUTED = "#6b7280";
const LINK = "#15803d";
const LINK_STYLE = `color:${LINK};`;
const PARAGRAPH_STYLE = "margin:0 0 16px;";

type Block = { kind: "paragraph"; lines: string[] } | { kind: "list"; items: string[] };

function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.replace(/\r\n?/g, "\n").trim().split("\n")) {
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1];
    if (line.trim() === "") {
      blocks.push({ kind: "paragraph", lines: [] });
    } else if (/^- /.test(line)) {
      if (last?.kind === "list") last.items.push(line.slice(2));
      else blocks.push({ kind: "list", items: [line.slice(2)] });
    } else if (last?.kind === "paragraph") {
      last.lines.push(line);
    } else {
      blocks.push({ kind: "paragraph", lines: [line] });
    }
  }
  return blocks.filter((block) => (block.kind === "list" ? block.items.length : block.lines.length) > 0);
}

export type RenderInput = {
  campaign: Pick<Campaign, "subject" | "body">;
  /** The recipient's full name as stored; only the first word is used. */
  name: string | null | undefined;
  unsubscribeUrl: string;
  /** Mail language: footer wording and the name fallback. Default "id". */
  locale?: "id" | "en";
};

/** Plain readable HTML and the matching text part. The unsubscribe footer is always appended. */
export function renderBroadcast({ campaign, name, unsubscribeUrl, locale = "id" }: RenderInput): RenderedMail {
  const copy = LOCALE_COPY[locale];
  const who = firstName(name, copy.fallbackName);
  const blocks = parseBlocks(campaign.body);

  const htmlBlocks = blocks.map((block) =>
    block.kind === "list"
      ? `<ul style="margin:0 0 16px;padding-left:22px;">${block.items
          .map((item) => `<li style="margin:0 0 6px;">${lineToHtml(item, who)}</li>`)
          .join("")}</ul>`
      : `<p style="${PARAGRAPH_STYLE}">${block.lines.map((line) => lineToHtml(line, who)).join("<br>")}</p>`,
  );
  const footerHtml = `${copy.unsubscribe} <a href="${escapeHtml(unsubscribeUrl)}" style="color:${MUTED};">${copy.unsubscribeLink}</a>`;

  const html = `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(campaign.subject)}</title></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;color:${INK};font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;">
<div style="max-width:560px;margin:0 auto;">
${htmlBlocks.join("\n")}
<p style="margin:28px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12px;color:${MUTED};">${footerHtml}</p>
</div>
</body></html>`;

  const textBlocks = blocks.map((block) =>
    block.kind === "list"
      ? block.items.map((item) => `- ${lineToText(item, who)}`).join("\n")
      : block.lines.map((line) => lineToText(line, who)).join("\n"),
  );
  const text = `${textBlocks.join("\n\n")}\n\n${copy.unsubscribe} ${copy.unsubscribeLink}: ${unsubscribeUrl}\n`;

  return { subject: campaign.subject, html, text };
}
