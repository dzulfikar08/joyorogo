// Ported from JoyoFit (watch-fit) src/features/ai/adapters/sse.ts, adapted for JoyoRogo.
/** One server-sent event: the optional `event:` name and the joined `data:` lines. */
export interface SseEvent {
  event: string | null;
  data: string;
}

/**
 * Incremental parser of a server-sent-events byte stream. Feed decoded text with `push`; it calls `onEvent` for every complete event
 * (a blank line ends one) and keeps the unfinished tail. Handles `\r\n`, `\r` and `\n`, several `data:` lines, comment lines
 * (`: keep-alive`), a missing space after the colon and a split in the middle of a line. `flush` emits a final event that had no
 * blank line after it.
 */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = '';
  let event: string | null = null;
  let data: string[] = [];
  let skipLf = false;

  const dispatch = () => {
    if (data.length > 0 || event !== null) onEvent({ event, data: data.join('\n') });
    event = null;
    data = [];
  };
  const line = (text: string) => {
    if (text === '') return dispatch();
    if (text.startsWith(':')) return;
    const at = text.indexOf(':');
    const field = at === -1 ? text : text.slice(0, at);
    let value = at === -1 ? '' : text.slice(at + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  };

  return {
    push(chunk: string): void {
      let text = chunk;
      if (skipLf && text.startsWith('\n')) text = text.slice(1);
      skipLf = false;
      buffer += text;
      let start = 0;
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i];
        if (ch !== '\n' && ch !== '\r') continue;
        line(buffer.slice(start, i));
        if (ch === '\r') {
          if (buffer[i + 1] === '\n') i += 1;
          else if (i + 1 === buffer.length) skipLf = true;
        }
        start = i + 1;
      }
      buffer = buffer.slice(start);
    },
    flush(): void {
      if (buffer !== '') line(buffer);
      buffer = '';
      dispatch();
    },
  };
}

/**
 * Splits `<think>...</think>` out of streamed content: the text outside goes on as the answer, the text inside as reasoning
 * (Ollama, LM Studio and vLLM serve some models, like DeepSeek-R1 distills and Qwen, with the reasoning inline). A tag cut in two
 * chunks is held back until it is whole. `end` releases whatever is held.
 */
export function createThinkSplitter() {
  let inside = false;
  let held = '';
  const OPEN = '<think>';
  const CLOSE = '</think>';

  const run = (input: string, final: boolean): { text: string; thinking: string } => {
    let text = '';
    let thinking = '';
    let rest = held + input;
    held = '';
    while (rest.length > 0) {
      const tag = inside ? CLOSE : OPEN;
      const at = rest.indexOf(tag);
      if (at !== -1) {
        if (inside) thinking += rest.slice(0, at);
        else text += rest.slice(0, at);
        rest = rest.slice(at + tag.length);
        inside = !inside;
        continue;
      }
      // Hold a tail that could be the start of the tag.
      let keep = 0;
      if (!final) {
        for (let n = Math.min(tag.length - 1, rest.length); n > 0; n--) {
          if (tag.startsWith(rest.slice(rest.length - n))) {
            keep = n;
            break;
          }
        }
      }
      const emit = rest.slice(0, rest.length - keep);
      if (inside) thinking += emit;
      else text += emit;
      held = rest.slice(rest.length - keep);
      rest = '';
    }
    return { text, thinking };
  };

  return { push: (chunk: string) => run(chunk, false), end: () => run('', true) };
}

/** The whole-answer version of {@link createThinkSplitter}. */
export function splitThink(content: string): { text: string; thinking: string } {
  const splitter = createThinkSplitter();
  const a = splitter.push(content);
  const b = splitter.end();
  return { text: a.text + b.text, thinking: a.thinking + b.thinking };
}
