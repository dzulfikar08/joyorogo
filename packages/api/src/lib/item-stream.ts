/**
 * Incremental reader of the model's single-line answer
 * `{"items":[{...},{...}],...}`: feed it text as it streams in and it reports
 * each item's name as soon as that string is complete and each item object as
 * soon as it closes. The same scanner backs `salvageItems` (one push of the
 * whole text), so streamed and non-streamed answers agree on what an item is.
 *
 * Braces inside strings do not count; the unfinished last object is never
 * reported as an item.
 */
export type ItemScanEvent =
  /** The name (and, when asked for, the localName) of the open item is complete. */
  | { kind: "name"; index: number; name: string; localName?: string }
  /** The open item object closed and parsed. `index` is its position in the array. */
  | { kind: "item"; index: number; raw: unknown };

const ITEMS_KEY = /"items"\s*:\s*\[/;
const NAME_VALUE = /"name"\s*:\s*("(?:[^"\\]|\\.)*")/;
const LOCAL_NAME_VALUE = /"localName"\s*:\s*("(?:[^"\\]|\\.)*")/;

function stringValue(pattern: RegExp, text: string): string | undefined {
  const match = pattern.exec(text);
  if (!match) return undefined;
  try {
    const value: unknown = JSON.parse(match[1]!);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export class ItemScanner {
  private text = "";
  /** Next character to look at, or -1 until the `"items":[` array has opened. */
  private pos = -1;
  private depth = 0;
  private start = -1;
  private inString = false;
  private escaped = false;
  private finished = false;
  /** Objects seen so far, including malformed ones: the index of the next one. */
  private count = 0;
  private nameSent = false;

  /** `needLocalName`: hold the name event until `localName` is there too. */
  constructor(private readonly needLocalName = false) {}

  /** The array closed (`]`) or the text turned out malformed: nothing more will come. */
  get done(): boolean {
    return this.finished;
  }

  push(chunk: string): ItemScanEvent[] {
    if (this.finished) return [];
    this.text += chunk;
    if (this.pos === -1) {
      const key = ITEMS_KEY.exec(this.text);
      if (!key) return [];
      this.pos = key.index + key[0].length;
    }
    const events: ItemScanEvent[] = [];
    const text = this.text;
    let i = this.pos;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (ch === "\\") this.escaped = true;
        else if (ch === '"') this.inString = false;
      } else if (ch === '"') {
        this.inString = true;
      } else if (ch === "{") {
        if (this.depth === 0) {
          this.start = i;
          this.nameSent = false;
        }
        this.depth += 1;
      } else if (ch === "}") {
        this.depth -= 1;
        if (this.depth === 0 && this.start !== -1) {
          const index = this.count++;
          try {
            events.push({ kind: "item", index, raw: JSON.parse(text.slice(this.start, i + 1)) });
          } catch {
            // a malformed object is skipped, the rest still counts
          }
          this.start = -1;
        } else if (this.depth < 0) {
          this.finished = true;
          break;
        }
      } else if (ch === "]" && this.depth === 0) {
        this.finished = true;
        break;
      }
    }
    this.pos = i;
    if (!this.finished && this.start !== -1 && !this.nameSent) {
      const open = text.slice(this.start);
      const name = stringValue(NAME_VALUE, open);
      const localName = stringValue(LOCAL_NAME_VALUE, open);
      if (name !== undefined && (!this.needLocalName || localName !== undefined)) {
        this.nameSent = true;
        events.push({
          kind: "name",
          index: this.count,
          name,
          ...(localName !== undefined ? { localName } : {}),
        });
      }
    }
    return events;
  }
}

/**
 * Every complete item object of an `"items":[...]` array, even when the answer
 * is cut off mid-item (max_tokens) so the whole text is not valid JSON.
 */
export function scanItems(text: string): unknown[] {
  const scanner = new ItemScanner();
  const out: unknown[] = [];
  for (const event of scanner.push(text)) {
    if (event.kind === "item") out.push(event.raw);
  }
  return out;
}
