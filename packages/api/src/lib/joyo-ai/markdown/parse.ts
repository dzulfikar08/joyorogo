// Ported from JoyoFit (watch-fit) src/features/ai/markdown/parse.ts, adapted for JoyoRogo.
/**
 * A small, total markdown parser for chat answers: paragraphs, headings (levels 4 to 6 fold into 3), bold, italic,
 * inline code, fenced code, bullet and ordered lists (nested lists are flattened with a depth per item), blockquotes,
 * GFM tables, horizontal rules, `http(s)`/`mailto` links and hard line breaks. Raw HTML and every other construct stay literal text.
 *
 * Pure and linear: no regex with nested quantifiers, bracket pairs are matched in one pass, emphasis uses a frame stack.
 * It never throws; any input yields blocks, and no character of the input other than markdown syntax is dropped.
 */

export type Inline =
  | { t: 'text'; s: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'code'; s: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

/**
 * One list line. `depth` is the nesting level (0 = top level, at most {@link MAX_LIST_DEPTH}); `n` is the number to show
 * for an ordered item (already counted per level, `1. 1. 1.` becomes 1, 2, 3) and `null` for a bullet. A block is `ul`
 * or `ol` after its first item; a bullet nested under an ordered item (or the reverse) stays inside the same block and
 * carries its own `n`.
 */
export interface ListItem {
  c: Inline[];
  depth: number;
  n: number | null;
}

export type Align = 'left' | 'right' | 'center' | null;

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'ul'; items: ListItem[] }
  | { t: 'ol'; start: number; items: ListItem[] }
  | { t: 'code'; lang: string | null; text: string; open: boolean }
  | { t: 'quote'; c: Block[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][]; align: Align[] }
  | { t: 'hr' };

export interface ParseOptions {
  /**
   * The text is a partial answer still arriving. Only the last block is affected: an unclosed `**`, `*`, `_` or backtick
   * renders as the emphasis or code so far instead of literal markers, and a half-typed table delimiter row still starts a table.
   */
  streaming?: boolean;
}

export const MAX_LIST_DEPTH = 4;
const MAX_QUOTE_DEPTH = 6;
const MAX_DEST = 2048;

export function parseMarkdown(text: string, options: ParseOptions = {}): Block[] {
  if (typeof text !== 'string' || text === '') return [];
  try {
    return parseBlocks(text.split(/\r\n|\r|\n/), 0, options.streaming === true);
  } catch {
    return [{ t: 'p', c: [{ t: 'text', s: text }] }];
  }
}

/* ------------------------------------------------------------------ blocks */

const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const DELIM_CELL = /^:?-+:?$/;
const QUOTE = /^ {0,3}>/;

function isBlank(line: string): boolean {
  return !/\S/.test(line);
}

function reachesEnd(lines: string[], from: number): boolean {
  for (let k = from; k < lines.length; k++) if (!isBlank(lines[k]!)) return false;
  return true;
}

function indentWidth(ws: string): number {
  let w = 0;
  for (let k = 0; k < ws.length; k++) w += ws[k] === '\t' ? 4 : 1;
  return w;
}

interface Fence {
  indent: number;
  ch: string;
  len: number;
  lang: string | null;
}

function fenceStart(line: string): Fence | null {
  const m = FENCE.exec(line);
  if (!m) return null;
  const info = m[3]!.trim();
  if (m[2]![0] === '`' && info.includes('`')) return null;
  const lang = /^\S+/.exec(info);
  return { indent: m[1]!.length, ch: m[2]![0]!, len: m[2]!.length, lang: lang ? lang[0] : null };
}

function isHr(line: string): boolean {
  const t = line.trim();
  const marker = t[0];
  if (marker !== '-' && marker !== '*' && marker !== '_') return false;
  if (line.length - line.trimStart().length > 3) return false;
  let count = 0;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === marker) count++;
    else if (c !== ' ' && c !== '\t') return false;
  }
  return count >= 3;
}

function headingOf(line: string): { level: 1 | 2 | 3; text: string } | null {
  const m = HEADING.exec(line);
  if (!m) return null;
  let text = (m[2] ?? '').trim();
  let e = text.length;
  while (e > 0 && text[e - 1] === '#') e--;
  if (e === 0 || text[e - 1] === ' ' || text[e - 1] === '\t') text = text.slice(0, e).trimEnd();
  const len = m[1]!.length;
  return { level: len <= 3 ? (len as 1 | 2 | 3) : 3, text };
}

function isQuote(line: string, depth: number): boolean {
  return depth < MAX_QUOTE_DEPTH && QUOTE.test(line);
}

/** A line that ends a paragraph or list item: it starts a different block. */
function startsBlock(line: string, depth: number): boolean {
  return fenceStart(line) !== null || isHr(line) || headingOf(line) !== null || isQuote(line, depth);
}

/** A list line that may interrupt a paragraph: any bullet with text, or `1.` with text. */
function interruptsParagraph(line: string): boolean {
  const m = LIST_ITEM.exec(line);
  if (!m || !m[3]) return false;
  const marker = m[2]!;
  return marker === '-' || marker === '*' || marker === '+' || parseInt(marker, 10) === 1;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '\\' && k + 1 < s.length) {
      cur += c + s[k + 1];
      k++;
    } else if (c === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

function tableHead(lines: string[], i: number, streaming: boolean): { head: string[]; align: Align[] } | null {
  if (i + 1 >= lines.length) return null;
  const first = lines[i]!;
  const second = lines[i + 1]!;
  if (first.indexOf('|') < 0 && second.indexOf('|') < 0) return null;
  const dcells = splitRow(second);
  for (const cell of dcells) if (!DELIM_CELL.test(cell)) return null;
  const head = splitRow(first);
  if (dcells.length !== head.length) {
    // A delimiter row still being typed: `|---` under a three column header.
    if (!(streaming && dcells.length < head.length && reachesEnd(lines, i + 2))) return null;
  }
  return { head, align: head.map((_, k) => (k < dcells.length ? alignOf(dcells[k]!) : null)) };
}

function normalizeRow(line: string, width: number): string[] {
  const cells = splitRow(line);
  if (cells.length > width) {
    const merged = cells.slice(width - 1).join('|');
    cells.length = width - 1;
    cells.push(merged);
  }
  while (cells.length < width) cells.push('');
  return cells;
}

function parseBlocks(lines: string[], depth: number, streaming: boolean): Block[] {
  const out: Block[] = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = fenceStart(line);
    if (fence) {
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const l = lines[j]!;
        const close = FENCE_CLOSE.exec(l);
        if (close && close[1]![0] === fence.ch && close[1]!.length >= fence.len) {
          closed = true;
          j++;
          break;
        }
        let strip = 0;
        while (strip < fence.indent && l[strip] === ' ') strip++;
        body.push(strip ? l.slice(strip) : l);
        j++;
      }
      if (!closed) {
        if (body.length > 0 && body[body.length - 1] === '') body.pop();
        // A closing fence still being typed (`` or ~~) is not code.
        const last = body[body.length - 1];
        if (streaming && last !== undefined && last.length <= 5 && /^ {0,3}(`{1,2}|~{1,2})$/.test(last) && last.trim()[0] === fence.ch) body.pop();
      }
      out.push({ t: 'code', lang: fence.lang, text: body.join('\n'), open: !closed });
      i = j;
      continue;
    }

    if (isHr(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }

    const heading = headingOf(line);
    if (heading) {
      i++;
      out.push({ t: 'h', level: heading.level, c: parseInline(heading.text, streaming && reachesEnd(lines, i)) });
      continue;
    }

    if (isQuote(line, depth)) {
      const inner: string[] = [];
      let j = i;
      while (j < n) {
        const l = lines[j]!;
        if (isQuote(l, depth)) {
          inner.push(l.replace(/^ {0,3}> ?/, ''));
        } else if (
          !isBlank(l) &&
          inner.length > 0 &&
          !isBlank(inner[inner.length - 1]!) &&
          !startsBlock(l, depth) &&
          !interruptsParagraph(l)
        ) {
          inner.push(l);
        } else break;
        j++;
      }
      out.push({ t: 'quote', c: parseBlocks(inner, depth + 1, streaming && reachesEnd(lines, j)) });
      i = j;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = readList(lines, i, depth, streaming);
      out.push(list.block);
      i = list.next;
      continue;
    }

    const table = tableHead(lines, i, streaming);
    if (table) {
      const width = table.head.length;
      const rowLines: string[] = [];
      let j = i + 2;
      while (j < n && !isBlank(lines[j]!) && lines[j]!.indexOf('|') >= 0 && fenceStart(lines[j]!) === null) {
        rowLines.push(lines[j]!);
        j++;
      }
      const tail = streaming && reachesEnd(lines, j);
      const last = rowLines.length - 1;
      out.push({
        t: 'table',
        align: table.align,
        head: table.head.map((cell) => parseInline(cell, tail && last < 0)),
        rows: rowLines.map((row, r) => normalizeRow(row, width).map((cell) => parseInline(cell, tail && r === last))),
      });
      i = j;
      continue;
    }

    // Paragraph.
    const para: string[] = [line.trimStart()];
    let j = i + 1;
    while (j < n) {
      const l = lines[j]!;
      if (isBlank(l) || startsBlock(l, depth) || interruptsParagraph(l)) break;
      if (l.indexOf('|') >= 0 && tableHead(lines, j, streaming)) break;
      para.push(l.trimStart());
      j++;
    }
    para[para.length - 1] = para[para.length - 1]!.trimEnd();
    out.push({ t: 'p', c: parseInline(para.join('\n'), streaming && reachesEnd(lines, j)) });
    i = j;
  }
  return out;
}

function readList(lines: string[], start: number, depth: number, streaming: boolean): { block: Block; next: number } {
  const n = lines.length;
  const raws: { raw: string; depth: number; n: number | null }[] = [];
  const stack: number[] = [];
  const counters: (number | undefined)[] = [];
  let firstOrdered: number | null = null;
  let firstKind: 'ul' | 'ol' = 'ul';
  let j = start;
  let end = start;

  while (j < n) {
    const line = lines[j]!;
    if (isBlank(line)) {
      let k = j + 1;
      while (k < n && isBlank(lines[k]!)) k++;
      if (k < n && LIST_ITEM.test(lines[k]!) && !isHr(lines[k]!)) {
        j = k;
        continue;
      }
      break;
    }
    const m = LIST_ITEM.exec(line);
    if (m && !isHr(line)) {
      const width = indentWidth(m[1]!);
      if (stack.length === 0) stack.push(width);
      else if (width > stack[stack.length - 1]!) stack.push(width);
      else {
        while (stack.length > 1 && width < stack[stack.length - 1]!) stack.pop();
        if (width > stack[stack.length - 1]!) stack.push(width);
      }
      const level = Math.min(stack.length - 1, MAX_LIST_DEPTH);
      const ordered = /\d/.test(m[2]![0]!);
      if (level === 0 && raws.length > 0 && (ordered ? 'ol' : 'ul') !== firstKind) break;
      let num: number | null = null;
      if (ordered) {
        const own = parseInt(m[2]!, 10);
        const prev = counters[level];
        num = prev !== undefined ? prev + 1 : own;
        counters.length = level;
        counters[level] = num;
      } else {
        counters.length = level;
      }
      if (raws.length === 0) {
        firstKind = ordered ? 'ol' : 'ul';
        firstOrdered = num;
      }
      raws.push({ raw: m[3] ?? '', depth: level, n: num });
      j++;
      end = j;
      continue;
    }
    if (startsBlock(line, depth)) break;
    raws[raws.length - 1]!.raw += '\n' + line.trimStart();
    j++;
    end = j;
  }

  const tail = streaming && reachesEnd(lines, end);
  const items: ListItem[] = raws.map((r, k) => ({
    c: parseInline(k === raws.length - 1 ? r.raw.trimEnd() : r.raw, tail && k === raws.length - 1),
    depth: r.depth,
    n: r.n,
  }));
  const block: Block = firstKind === 'ol' ? { t: 'ol', start: firstOrdered ?? 1, items } : { t: 'ul', items };
  return { block, next: end };
}

/* ----------------------------------------------------------------- inlines */

const SAFE_URL = /^(?:https?:\/\/|mailto:)\S+$/i;

function isWs(ch: string | undefined): boolean {
  return ch === undefined || ch === '' || /\s/.test(ch);
}

function isWord(ch: string | undefined): boolean {
  if (ch === undefined || ch === '') return false;
  const c = ch.charCodeAt(0);
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  return /[\p{L}\p{N}]/u.test(ch);
}

function pushText(nodes: Inline[], s: string): void {
  if (!s) return;
  const last = nodes[nodes.length - 1];
  if (last && last.t === 'text') last.s += s;
  else nodes.push({ t: 'text', s });
}

function appendAll(target: Inline[], nodes: Inline[]): void {
  for (const node of nodes) {
    if (node.t === 'text') pushText(target, node.s);
    else target.push(node);
  }
}

interface Frame {
  ch: string;
  count: number;
  nodes: Inline[];
}

function isSpecial(code: number): boolean {
  // \ \n ` [ * _ h
  return code === 92 || code === 10 || code === 96 || code === 91 || code === 42 || code === 95 || code === 104;
}

/** Bare URL at `i`: end index (exclusive) of the URL with trailing punctuation removed, or -1. */
function bareUrlEnd(src: string, i: number): number {
  const prefix = src.startsWith('https://', i) ? 8 : src.startsWith('http://', i) ? 7 : 0;
  if (prefix === 0) return -1;
  if (i > 0 && isWord(src[i - 1])) return -1;
  let p = i + prefix;
  while (p < src.length && !/[\s<>]/.test(src[p]!)) p++;
  while (p > i + prefix) {
    const c = src[p - 1];
    if (c === ')') {
      let open = 0;
      let close = 0;
      for (let k = i; k < p; k++) {
        if (src[k] === '(') open++;
        else if (src[k] === ')') close++;
      }
      if (close <= open) break;
      p--;
    } else if (/[.,;:!?'"*_\]}]/.test(c!)) p--;
    else break;
  }
  return p > i + prefix ? p : -1;
}

function parseInline(src: string, tail: boolean, noLinks = false): Inline[] {
  const n = src.length;
  if (n === 0) return [];
  const frames: Frame[] = [{ ch: '', count: 0, nodes: [] }];
  const open: Record<string, number> = { '*': 0, _: 0 };
  const noClose = new Set<number>();
  let pairs: Int32Array | null = null;
  let buf = '';

  const top = (): Frame => frames[frames.length - 1]!;
  const flush = (): void => {
    if (buf) {
      pushText(top().nodes, buf);
      buf = '';
    }
  };
  const dissolve = (): void => {
    const f = frames.pop() as Frame;
    open[f.ch]!--;
    const parent = top().nodes;
    pushText(parent, f.ch.repeat(f.count));
    appendAll(parent, f.nodes);
  };

  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && !isSpecial(src.charCodeAt(j))) j++;
    if (j > i) {
      buf += src.slice(i, j);
      i = j;
      if (i >= n) break;
    }
    const c = src[i];

    if (c === '\\') {
      const next = src[i + 1];
      if (next === '\n') {
        flush();
        top().nodes.push({ t: 'br' });
        i += 2;
        while (src[i] === ' ' || src[i] === '\t') i++;
      } else if (next !== undefined && /[!-/:-@[-`{-~]/.test(next)) {
        buf += next;
        i += 2;
      } else {
        buf += c;
        i++;
      }
      continue;
    }

    if (c === '\n') {
      if (buf.endsWith('  ')) {
        buf = buf.trimEnd();
        flush();
        top().nodes.push({ t: 'br' });
      } else {
        buf = buf.trimEnd() + ' ';
      }
      i++;
      while (src[i] === ' ' || src[i] === '\t') i++;
      continue;
    }

    if (c === '`') {
      let k = i;
      while (src[k] === '`') k++;
      const len = k - i;
      let close = -1;
      if (!noClose.has(len)) {
        let from = k;
        for (;;) {
          const p = src.indexOf('`', from);
          if (p < 0) break;
          let q = p;
          while (src[q] === '`') q++;
          if (q - p === len) {
            close = p;
            break;
          }
          from = q;
        }
        if (close < 0) noClose.add(len);
      }
      if (close >= 0 || (tail && k < n && !src.slice(k).includes('`'))) {
        const end = close >= 0 ? close : n;
        let body = src.slice(k, end).replace(/\n/g, ' ');
        if (body.length > 2 && body[0] === ' ' && body[body.length - 1] === ' ' && /\S/.test(body)) body = body.slice(1, -1);
        flush();
        top().nodes.push({ t: 'code', s: body });
        i = close >= 0 ? close + len : n;
      } else {
        buf += src.slice(i, k);
        i = k;
      }
      continue;
    }

    if (c === '[' && !noLinks) {
      if (pairs === null) {
        pairs = new Int32Array(n).fill(-1);
        const stack: number[] = [];
        for (let k = 0; k < n; k++) {
          const ch = src[k];
          if (ch === '\\') k++;
          else if (ch === '[') stack.push(k);
          else if (ch === ']' && stack.length > 0) pairs[stack.pop() as number] = k;
        }
      }
      const close = pairs[i];
      if (close !== undefined && close > i + 1 && src[close + 1] === '(') {
        let p = close + 2;
        let level = 1;
        const limit = Math.min(n, p + MAX_DEST);
        while (p < limit) {
          const ch = src[p]!;
          if (ch === '(') level++;
          else if (ch === ')') {
            level--;
            if (level === 0) break;
          } else if (/\s/.test(ch)) break;
          p++;
        }
        if (p < limit && level === 0) {
          const href = src.slice(close + 2, p);
          if (SAFE_URL.test(href)) {
            const label = parseInline(src.slice(i + 1, close), false, true);
            if (label.length > 0) {
              flush();
              top().nodes.push({ t: 'link', href, c: label });
              i = p + 1;
              continue;
            }
          }
          buf += src.slice(i, p + 1);
          i = p + 1;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }

    if (c === 'h') {
      const end = noLinks ? -1 : bareUrlEnd(src, i);
      if (end > 0) {
        const href = src.slice(i, end);
        flush();
        top().nodes.push({ t: 'link', href, c: [{ t: 'text', s: href }] });
        i = end;
      } else {
        buf += c;
        i++;
      }
      continue;
    }

    if (c === '*' || c === '_') {
      let k = i;
      while (src[k] === c) k++;
      const prev = i > 0 ? src[i - 1] : undefined;
      const next = src[k];
      const strict = c === '_' || k - i === 1;
      const canOpen = !isWs(next) && (!strict || !isWord(prev));
      const canClose = !isWs(prev) && (!strict || !isWord(next));
      let remaining = k - i;
      flush();
      if (canClose) {
        while (remaining > 0 && open[c]! > 0) {
          while (top().ch !== c) dissolve();
          const f = top();
          if (f.nodes.length === 0) break;
          const use = f.count >= 2 && remaining >= 2 ? 2 : 1;
          f.nodes = [{ t: use === 2 ? 'bold' : 'italic', c: f.nodes }];
          f.count -= use;
          remaining -= use;
          if (f.count === 0) {
            frames.pop();
            open[c]!--;
            appendAll(top().nodes, f.nodes);
          }
        }
      }
      if (remaining > 0) {
        if (canOpen) {
          frames.push({ ch: c, count: remaining, nodes: [] });
          open[c]!++;
        } else pushText(top().nodes, c.repeat(remaining));
      }
      i = k;
      continue;
    }

    buf += c;
    i++;
  }

  flush();
  while (frames.length > 1) {
    const f = top();
    if (tail && f.nodes.length > 0) {
      frames.pop();
      open[f.ch]!--;
      let nodes = f.nodes;
      for (let cnt = f.count; cnt > 0; ) {
        const use = cnt >= 2 ? 2 : 1;
        nodes = [{ t: use === 2 ? 'bold' : 'italic', c: nodes }];
        cnt -= use;
      }
      appendAll(top().nodes, nodes);
    } else dissolve();
  }
  return frames[0]!.nodes;
}
