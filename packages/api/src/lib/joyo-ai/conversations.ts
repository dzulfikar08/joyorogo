// Ported from JoyoFit (watch-fit) src/features/ai/conversations.ts, adapted for JoyoRogo.
import { isRecord } from './json';
import { TOOL_NAMES, type ToolName } from './tools';
import { PROVIDER_IDS, type Engine, type ProviderId } from './types';

/**
 * The conversations of Joyo AI, on this device only (never synced, never sent anywhere but as the turns of a question). Several
 * chats with titles: an index of small records under `joyorogo.ai.chats` and one entry per chat under `joyorogo.ai.chat.<id>`, so
 * opening the list never parses every message. The storage is a {@link KeyValue}: the native app binds files, the web localStorage.
 */
export const CHAT_LIMITS = { conversations: 30, messages: 80, contentChars: 8_000, reasoningChars: 2_000, titleChars: 48 } as const;

/** Where the conversations live. Reads may be async (files); a missing key is null. */
export interface KeyValue {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

const INDEX_KEY = 'joyorogo.ai.chats';
const CURRENT_KEY = 'joyorogo.ai.chatcur';
const chatKey = (id: string): string => `joyorogo.ai.chat.${id}`;

/** One line, control characters flattened, capped. */
const flat = (text: string, max: number): string => text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A tool the answer ran: what was read (plain arguments, never values) and how it went. */
export interface StepRecord {
  id: string;
  tool: ToolName;
  args: Record<string, string | number>;
  count: number | null;
  empty: boolean;
  failed: boolean;
  notConnected: boolean;
  /** A food tool found none of the named foods in our data. */
  unknown: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Epoch milliseconds. */
  at: number;
  /** Which engine wrote an assistant message. */
  engine?: Engine;
  provider?: ProviderId;
  model?: string;
  steps?: StepRecord[];
  /** The model's reasoning, capped; shown collapsed, never part of the answer and never sent back. */
  reasoning?: string;
  /** The fixed safety answer: no provider was called. */
  fixed?: boolean;
  /** The person pressed Stop: this is the partial text that had arrived. */
  stopped?: boolean;
  /** Tokens of the question that produced this answer, from the provider's own count. */
  tokens?: { input: number; output: number };
}

export interface ConversationMeta {
  id: string;
  /** Empty until the first question is sent; the screen shows its own "new chat" label then. */
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** The person named it themselves: the first question no longer sets the title. */
  custom?: boolean;
}

export interface Conversation extends ConversationMeta {
  messages: ChatMessage[];
}

/** A title from the first question: one line, trimmed, with an ellipsis when cut. */
export function titleOf(text: string): string {
  const one = flat(text, 400);
  if (one.length <= CHAT_LIMITS.titleChars) return one;
  return `${one.slice(0, CHAT_LIMITS.titleChars - 1).trimEnd()}\u2026`;
}

/** The turns as the engines take them: role and text only, nothing else leaves the phone. */
export const chatLines = (messages: readonly ChatMessage[]): { role: 'user' | 'assistant'; content: string }[] =>
  messages.map(({ role, content }) => ({ role, content }));

const isEngine = (v: unknown): v is Engine => v === 'hosted' || v === 'byok';
const isProvider = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);
const isTool = (v: unknown): v is ToolName => typeof v === 'string' && (TOOL_NAMES as readonly string[]).includes(v);

function toStep(raw: unknown, index: number): StepRecord | null {
  if (!isRecord(raw) || !isTool(raw.tool)) return null;
  const args: Record<string, string | number> = {};
  if (isRecord(raw.args)) for (const [k, v] of Object.entries(raw.args)) if (typeof v === 'string' || typeof v === 'number') args[k.slice(0, 24)] = typeof v === 'string' ? v.slice(0, 60) : v;
  return {
    id: typeof raw.id === 'string' ? raw.id.slice(0, 64) : `s${index}`,
    tool: raw.tool,
    args,
    count: typeof raw.count === 'number' ? raw.count : null,
    empty: raw.empty === true,
    failed: raw.failed === true,
    notConnected: raw.notConnected === true,
    unknown: raw.unknown === true,
  };
}

/** One stored value as a message, keeping the fields that are valid; null when it is not a message. */
export function toMessage(raw: unknown, fallbackId: string, fallbackAt: number): ChatMessage | null {
  if (!isRecord(raw) || (raw.role !== 'user' && raw.role !== 'assistant') || typeof raw.content !== 'string') return null;
  const message: ChatMessage = {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id.slice(0, 40) : fallbackId,
    role: raw.role,
    content: raw.content.slice(0, CHAT_LIMITS.contentChars),
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : fallbackAt,
  };
  if (isEngine(raw.engine)) message.engine = raw.engine;
  if (isProvider(raw.provider)) message.provider = raw.provider;
  if (typeof raw.model === 'string') message.model = raw.model.slice(0, 200);
  if (raw.fixed === true) message.fixed = true;
  if (raw.stopped === true) message.stopped = true;
  if (typeof raw.reasoning === 'string' && raw.reasoning !== '') message.reasoning = raw.reasoning.slice(0, CHAT_LIMITS.reasoningChars);
  if (Array.isArray(raw.steps)) {
    const steps = raw.steps.map(toStep).filter((s): s is StepRecord => s !== null);
    if (steps.length > 0) message.steps = steps;
  }
  if (isRecord(raw.tokens) && typeof raw.tokens.input === 'number' && typeof raw.tokens.output === 'number') message.tokens = { input: raw.tokens.input, output: raw.tokens.output };
  return message;
}

function toMeta(raw: unknown): ConversationMeta | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id.slice(0, 40),
    title: typeof raw.title === 'string' ? raw.title.slice(0, CHAT_LIMITS.titleChars) : '',
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    messageCount: typeof raw.messageCount === 'number' ? raw.messageCount : 0,
    ...(raw.custom === true ? { custom: true } : {}),
  };
}

export interface ChatStoreDeps {
  now?: () => number;
  newId?: () => string;
}

export interface ChatStore {
  /** Newest first. */
  list(): Promise<ConversationMeta[]>;
  get(id: string): Promise<Conversation | null>;
  /** The chat the person had open last, or null (then the screen starts a new one). */
  current(): Promise<string | null>;
  setCurrent(id: string | null): Promise<void>;
  /** A new conversation, saved at once; its title comes from the first question. */
  create(firstQuestion?: string): Promise<Conversation>;
  /** Replaces the messages of a conversation (after a send, an edit or a regenerate). The first question names the chat unless the person did. */
  setMessages(id: string, messages: readonly ChatMessage[]): Promise<Conversation | null>;
  rename(id: string, title: string): Promise<void>;
  /** Drops `messageId` and every message after it: the base of "edit and resend" and "regenerate". Returns the messages that were kept. */
  truncateFrom(id: string, messageId: string): Promise<ChatMessage[]>;
  remove(id: string): Promise<void>;
  /** Every conversation (the "delete all" of the privacy screen). */
  clearAll(): Promise<void>;
  subscribe(listener: () => void): () => void;
  newMessageId(): string;
}

async function readParsed(kv: KeyValue, key: string): Promise<unknown> {
  try {
    const raw = await kv.get(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** The conversation store. Reads never throw: a damaged entry is an empty chat or is left out of the list. Writes run one at a time. */
export function createChatStore(kv: KeyValue, deps: ChatStoreDeps = {}): ChatStore {
  const now = deps.now ?? Date.now;
  let counter = 0;
  const newId = deps.newId ?? (() => `c${now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`);
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };

  // Read-modify-write of the index must not interleave, so every operation waits for the one before it.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  const readIndex = async (): Promise<ConversationMeta[]> => {
    const raw = await readParsed(kv, INDEX_KEY);
    return (Array.isArray(raw) ? raw : [])
      .map(toMeta)
      .filter((m): m is ConversationMeta => m !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  };

  const read = async (id: string): Promise<Conversation | null> => {
    const meta = (await readIndex()).find((m) => m.id === id);
    if (!meta) return null;
    const raw = await readParsed(kv, chatKey(id));
    const list = isRecord(raw) && Array.isArray(raw.messages) ? raw.messages : [];
    const messages = list.map((m, i) => toMessage(m, `m${i}`, meta.createdAt)).filter((m): m is ChatMessage => m !== null);
    return { ...meta, messages };
  };

  const save = async (conversation: Conversation): Promise<Conversation> => {
    const messages = conversation.messages.slice(-CHAT_LIMITS.messages);
    const meta: ConversationMeta = { id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: now(), messageCount: messages.length, ...(conversation.custom ? { custom: true } : {}) };
    await kv.set(chatKey(conversation.id), JSON.stringify({ messages }));
    const all = [...(await readIndex()).filter((m) => m.id !== meta.id), meta].sort((a, b) => b.updatedAt - a.updatedAt);
    for (const dropped of all.slice(CHAT_LIMITS.conversations)) await kv.remove(chatKey(dropped.id));
    await kv.set(INDEX_KEY, JSON.stringify(all.slice(0, CHAT_LIMITS.conversations)));
    changed();
    return { ...meta, messages };
  };

  return {
    list: () => serial(readIndex),
    get: (id) => serial(() => read(id)),
    current: () =>
      serial(async () => {
        const id = await kv.get(CURRENT_KEY);
        return id !== null && (await readIndex()).some((m) => m.id === id) ? id : null;
      }),
    setCurrent: (id) =>
      serial(async () => {
        if (id === null) await kv.remove(CURRENT_KEY);
        else await kv.set(CURRENT_KEY, id);
        changed();
      }),
    create: (firstQuestion = '') =>
      serial(async () => {
        const at = now();
        const created = await save({ id: newId(), title: titleOf(firstQuestion), createdAt: at, updatedAt: at, messageCount: 0, messages: [] });
        await kv.set(CURRENT_KEY, created.id);
        return created;
      }),
    setMessages: (id, messages) =>
      serial(async () => {
        const conversation = await read(id);
        if (!conversation) return null;
        const firstUser = messages.find((m) => m.role === 'user');
        // The first question names the chat (also after it was edited), unless the person gave it a name.
        const title = conversation.custom ? conversation.title : firstUser ? titleOf(firstUser.content) : conversation.title;
        return save({ ...conversation, title, messages: messages.map((m) => ({ ...m, content: m.content.slice(0, CHAT_LIMITS.contentChars) })) });
      }),
    rename: (id, title) =>
      serial(async () => {
        const conversation = await read(id);
        if (!conversation) return;
        // An empty name goes back to the first question.
        const clean = titleOf(title);
        const first = conversation.messages.find((m) => m.role === 'user');
        await save({ ...conversation, title: clean !== '' ? clean : titleOf(first?.content ?? ''), custom: clean !== '' });
      }),
    truncateFrom: (id, messageId) =>
      serial(async () => {
        const conversation = await read(id);
        if (!conversation) return [];
        const at = conversation.messages.findIndex((m) => m.id === messageId);
        if (at === -1) return conversation.messages;
        const kept = conversation.messages.slice(0, at);
        await save({ ...conversation, messages: kept });
        return kept;
      }),
    remove: (id) =>
      serial(async () => {
        await kv.remove(chatKey(id));
        await kv.set(INDEX_KEY, JSON.stringify((await readIndex()).filter((m) => m.id !== id)));
        if ((await kv.get(CURRENT_KEY)) === id) await kv.remove(CURRENT_KEY);
        changed();
      }),
    clearAll: () =>
      serial(async () => {
        for (const meta of await readIndex()) await kv.remove(chatKey(meta.id));
        await kv.remove(INDEX_KEY);
        await kv.remove(CURRENT_KEY);
        changed();
      }),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    newMessageId: () => `m${now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`,
  };
}
