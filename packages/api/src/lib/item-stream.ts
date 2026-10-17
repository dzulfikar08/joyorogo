/**
 * Incremental reader of the model's single-line answer
 * `{"items":[{...},{...}],...}`: feed it text as it streams in and it reports
 * each item's name as soon as that string is complete and each item object as
 * soon as it closes. The same scanner backs `salvageItems` (one push of the
 * whole text), so streamed and non-streamed answers agree on what an item is.
 *
 * Gemma sometimes garbles the `":` after a numeric key (`"protein0,`,
 * `"carbs<td>70"`, `"fat Lap7,`). One bad key used to cost the whole item, or,
 * because it flips the string parity, every item after it. The text is
 * repaired first (repairKeys), an object that still is not JSON keeps the
 * fields that can be read (lenientItem), and a last item cut off by the token
 * limit is kept when its name and kcal are already written. Braces inside
 * strings do not count.
 */
export type ItemScanEvent =
  /** The name (and, when asked for, the localName) of the open item is complete. */
  | { kind: "name"; index: number; name: string; localName?: string }
  /** The item object closed and parsed. `index` is its position in the array. */
  | { kind: "item"; index: number; raw: unknown };

const ITEMS_KEY = /"items"\s*:\s*\[/;
const NAME_VALUE = /"name"\s*:\s*("(?:[^"\\]|\\.)*")/;
const LOCAL_NAME_VALUE = /"localName"\s*:\s*("(?:[^"\\]|\\.)*")/;

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const NUMERIC_KEYS = ["grams", "kcal", "protein", "carbs", "fat", "fiber", "confidence"] as const;
const STRING_KEYS = ["name", "localName", "kind", "portion"] as const;
const NUMERIC_KEY_ALTERNATIVES = NUMERIC_KEYS.join("|");

// A key position (after `{` or `,`) holding `"key` with no closing quote is
// never valid JSON, so these only ever touch garbled text, not string values
// (a quote inside a string is escaped, and `\"` does not follow a comma).
/** `"carbs;">2` / `"protein Pay12` / `"fat:20` / `"carbs<td>70"`: junk where `":` belongs, value intact. */
const GARBLED_VALUE = new RegExp(
  String.raw`([{,]\s*)"(${NUMERIC_KEY_ALTERNATIVES})(?!")[^\d{}\[\],]{0,400}?(${NUM})"?(?=\s*[,}])`,
  "g",
);
/** `"box\n\n[1,2,3,4]` / `"box;[...`: junk where `":` belongs before the box array. */
const GARBLED_BOX = new RegExp(String.raw`([{,]\s*)"box(?!")[^\d{}\[\],]{0,400}?(?=\[)`, "g");
/** `,"protein Pay,` : the value is gone too, so the pair goes. */
const GARBLED_NO_VALUE = new RegExp(
  String.raw`([{,])\s*"(?:${NUMERIC_KEY_ALTERNATIVES})(?!")[^\d{}\[\],":]{0,400}(?:,|(?=\}))`,
  "g",
);
const ANY_KEY = ["name", "localName", "kind", "portion", "box", ...NUMERIC_KEYS].join("|");
/** `,"protein Too many items, limit 10","carbs":70`: free text instead of a value, up to the next real key. */
const GARBLED_SPAN = new RegExp(
  String.raw`([{,])\s*"(?:${NUMERIC_KEY_ALTERNATIVES})(?!")[^{}\[\]]{0,300}?,\s*(?="(?:${ANY_KEY})"\s*:)`,
  "g",
);

/**
 * An answer whose every quote is backslash-escaped (`{\"items\":[...]}`, the
 * model wrote the JSON as if it sat inside a string) is that JSON with the
 * backslashes in the way. Real JSON always has bare quotes around its keys, so
 * text with even one bare quote (past the optional wrapping pair) is left alone.
 */
export function unescapeQuotes(text: string): string {
  if (!text.includes('\\"')) return text;
  const bare = text.trim().replace(/\\"/g, "").replace(/^"|"$/g, "");
  return bare.includes('"') ? text : text.replace(/\\"/g, '"');
}

/** Puts the `":` back after garbled numeric keys; text that is valid JSON passes through unchanged. */
export function repairKeys(text: string): string {
  return unescapeQuotes(text)
    .replace(GARBLED_VALUE, '$1"$2":$3')
    .replace(GARBLED_BOX, '$1"box":')
    .replace(GARBLED_SPAN, "$1")
    .replace(GARBLED_NO_VALUE, "$1")
    .replace(/,(\s*\})/g, "$1");
}

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

const STRING_PATTERNS = STRING_KEYS.map(
  (key) => [key, new RegExp(String.raw`"${key}"\s*:\s*("(?:[^"\\]|\\.)*")`)] as const,
);
// A number the model quoted (`"grams":"200"`) still reads as that number.
const NUMBER_PATTERNS = NUMERIC_KEYS.map(
  (key) => [key, new RegExp(String.raw`"${key}"\s*:\s*"?(${NUM})"?(?=\s*[,}\]])`)] as const,
);
const BOX_PATTERN = new RegExp(
  String.raw`"box"\s*:\s*\[\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*\]`,
);

/**
 * The readable fields of an item object that is not valid JSON (or is cut
 * off): every complete `"key":value` pair of the known keys. Null without a
 * name and a kcal: the item is not worth showing then. Macros that did not
 * survive stay unset and are filled from TKPI by calibration.
 */
export function lenientItem(text: string): Record<string, unknown> | null {
  const item: Record<string, unknown> = {};
  for (const [key, pattern] of STRING_PATTERNS) {
    const value = stringValue(pattern, text);
    if (value !== undefined) item[key] = value;
  }
  for (const [key, pattern] of NUMBER_PATTERNS) {
    const match = pattern.exec(text);
    if (match) item[key] = Number(match[1]);
  }
  const box = BOX_PATTERN.exec(text);
  if (box) item.box = box.slice(1, 5).map(Number);
  return typeof item.name === "string" && typeof item.kcal === "number" ? item : null;
}

type ScanState = {
  /** Closed objects, with their position in the array (malformed ones take an index but are absent). */
  objects: Array<{ index: number; raw: unknown }>;
  /** Objects closed so far, malformed included. */
  closed: number;
  /** Where the unfinished object starts, if one is open. */
  open: number | null;
  /** The array closed (`]`) or the text turned out malformed. */
  finished: boolean;
};

function parseObject(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return lenientItem(text) ?? undefined;
  }
}

function scan(text: string): ScanState {
  const state: ScanState = { objects: [], closed: 0, open: null, finished: false };
  const key = ITEMS_KEY.exec(text);
  if (!key) return state;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = key.index + key[0].length; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const raw = parseObject(text.slice(start, i + 1));
        if (raw !== undefined) state.objects.push({ index: state.closed, raw });
        state.closed += 1;
        start = -1;
      } else if (depth < 0) {
        state.finished = true;
        return state;
      }
    } else if (ch === "]" && depth === 0) {
      state.finished = true;
      return state;
    }
  }
  if (depth > 0 && start !== -1) state.open = start;
  return state;
}

export class ItemScanner {
  private raw = "";
  private text = "";
  private state: ScanState = { objects: [], closed: 0, open: null, finished: false };
  private nextIndex = 0;
  private nameSentFor = -1;

  /** `needLocalName`: hold the name event until `localName` is there too. */
  constructor(private readonly needLocalName = false) {}

  /** The array closed (`]`) or the text turned out malformed: nothing more will come. */
  get done(): boolean {
    return this.state.finished;
  }

  push(chunk: string): ItemScanEvent[] {
    if (this.state.finished) return [];
    // Rescan from the start each time: a repair can rewrite text the previous
    // scan already walked over, and an answer is only ~1-2 KB.
    this.raw += chunk;
    this.text = repairKeys(this.raw);
    this.state = scan(this.text);
    const events: ItemScanEvent[] = [];
    for (const object of this.state.objects) {
      if (object.index < this.nextIndex) continue;
      this.nextIndex = object.index + 1;
      events.push({ kind: "item", index: object.index, raw: object.raw });
    }
    if (this.state.open !== null && this.nameSentFor !== this.state.closed) {
      const open = this.text.slice(this.state.open);
      const name = stringValue(NAME_VALUE, open);
      const localName = stringValue(LOCAL_NAME_VALUE, open);
      if (name !== undefined && (!this.needLocalName || localName !== undefined)) {
        this.nameSentFor = this.state.closed;
        events.push({
          kind: "name",
          index: this.state.closed,
          name,
          ...(localName !== undefined ? { localName } : {}),
        });
      }
    }
    return events;
  }

  /**
   * The text ended. A last object cut off by the token limit still counts
   * when its name and kcal are written: the plate had that item and omitting
   * it would undercount.
   */
  end(): ItemScanEvent[] {
    if (this.state.finished || this.state.open === null) return [];
    const raw = lenientItem(this.text.slice(this.state.open));
    if (!raw) return [];
    const index = this.state.closed;
    this.state = { ...this.state, closed: index + 1, open: null };
    this.nextIndex = index + 1;
    return [{ kind: "item", index, raw }];
  }
}

/**
 * Every item object of an `"items":[...]` array, even when the answer is cut
 * off mid-item (max_tokens) or has garbled keys, so the whole text is not
 * valid JSON.
 */
export function scanItems(text: string): unknown[] {
  const scanner = new ItemScanner();
  return [...scanner.push(text), ...scanner.end()].flatMap((event) =>
    event.kind === "item" ? [event.raw] : [],
  );
}
