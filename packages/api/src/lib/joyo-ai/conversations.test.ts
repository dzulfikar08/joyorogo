// Ported from JoyoFit (watch-fit) src/features/ai/conversations.test.ts, adapted for JoyoRogo (async KeyValue store).
import { describe, expect, test } from 'bun:test';

import { CHAT_LIMITS, chatLines, createChatStore, titleOf, toMessage, type ChatMessage } from './conversations';
import { memoryKeyValue } from './testFixtures';

function store(opts: { async?: boolean } = {}) {
  const kv = memoryKeyValue(opts);
  let clock = 1_000_000;
  let n = 0;
  const chats = createChatStore(kv, { now: () => (clock += 1000), newId: () => `c${n++}` });
  return { kv, chats };
}

const user = (id: string, content: string): ChatMessage => ({ id, role: 'user', content, at: 1 });
const bot = (id: string, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'assistant', content, at: 2, ...extra });
const step = { id: 's', tool: 'compare_foods' as const, args: { foods: 'pepaya, melon' }, count: 2, empty: false, failed: false, notConnected: false, unknown: false };

for (const asyncKv of [false, true]) {
  describe(`conversation store (${asyncKv ? 'async' : 'sync'} storage)`, () => {
    test('create, save messages, read back; the title comes from the first question', async () => {
      const { chats } = store({ async: asyncKv });
      const created = await chats.create();
      expect(created.title).toBe('');
      await chats.setMessages(created.id, [user('a', 'Mana yang seratnya paling tinggi?'), bot('b', 'Pepaya.', { engine: 'hosted', model: 'm', steps: [step] })]);
      const read = (await chats.get(created.id))!;
      expect(read.title).toBe('Mana yang seratnya paling tinggi?');
      expect(read.messages).toHaveLength(2);
      expect(read.messages[1]).toMatchObject({ engine: 'hosted', model: 'm', steps: [{ tool: 'compare_foods', count: 2, args: { foods: 'pepaya, melon' } }] });
      expect((await chats.list())[0]).toMatchObject({ id: created.id, messageCount: 2 });
      expect(await chats.current()).toBe(created.id);
    });

    test('the list is newest first and a long title is cut with an ellipsis', async () => {
      const { chats } = store({ async: asyncKv });
      const a = await chats.create('pertama');
      const b = await chats.create('x'.repeat(200));
      await chats.setMessages(a.id, [user('1', 'pertama')]);
      expect((await chats.list()).map((m) => m.id)).toEqual([a.id, b.id]);
      expect((await chats.get(b.id))!.title.length).toBe(CHAT_LIMITS.titleChars);
      expect((await chats.get(b.id))!.title.endsWith('\u2026')).toBe(true);
      expect(titleOf('a\nb\tc')).toBe('a b c');
    });

    test('rename sets a custom title the first question no longer replaces; empty goes back to the question', async () => {
      const { chats } = store({ async: asyncKv });
      const c = await chats.create();
      await chats.setMessages(c.id, [user('1', 'pertanyaan')]);
      await chats.rename(c.id, 'Serat buah');
      await chats.setMessages(c.id, [user('1', 'diubah')]);
      expect((await chats.get(c.id))!.title).toBe('Serat buah');
      await chats.rename(c.id, '  ');
      expect((await chats.get(c.id))!.title).toBe('diubah');
    });

    test('truncateFrom keeps what came before: the base of edit-and-resend and regenerate', async () => {
      const { chats } = store({ async: asyncKv });
      const c = await chats.create('q');
      await chats.setMessages(c.id, [user('1', 'q1'), bot('2', 'a1'), user('3', 'q2'), bot('4', 'a2')]);
      expect((await chats.truncateFrom(c.id, '4')).map((m) => m.id)).toEqual(['1', '2', '3']);
      expect((await chats.truncateFrom(c.id, '3')).map((m) => m.id)).toEqual(['1', '2']);
      expect((await chats.get(c.id))!.messages.map((m) => m.id)).toEqual(['1', '2']);
      expect((await chats.truncateFrom(c.id, 'nope')).map((m) => m.id)).toEqual(['1', '2']);
      expect(await chats.truncateFrom('missing', '1')).toEqual([]);
    });

    test('remove forgets one conversation and its current mark; clearAll forgets everything', async () => {
      const { chats, kv } = store({ async: asyncKv });
      const a = await chats.create('a');
      const b = await chats.create('b');
      await chats.remove(b.id);
      expect((await chats.list()).map((m) => m.id)).toEqual([a.id]);
      expect(await chats.current()).toBeNull();
      await chats.clearAll();
      expect(await chats.list()).toEqual([]);
      expect(Object.keys(kv.dump())).toEqual([]);
    });

    test('limits: 30 conversations (the oldest go), 80 messages, 8,000 characters a message', async () => {
      const { chats, kv } = store({ async: asyncKv });
      const first = await chats.create('first');
      for (let i = 0; i < CHAT_LIMITS.conversations + 2; i++) await chats.create(`c${i}`);
      expect(await chats.list()).toHaveLength(CHAT_LIMITS.conversations);
      expect(await chats.get(first.id)).toBeNull();
      expect(kv.dump()[`joyorogo.ai.chat.${first.id}`]).toBeUndefined();
      const c = await chats.create('long');
      await chats.setMessages(c.id, Array.from({ length: 100 }, (_, i) => user(`m${i}`, 'x'.repeat(9000))));
      const read = (await chats.get(c.id))!;
      expect(read.messages).toHaveLength(CHAT_LIMITS.messages);
      expect(read.messages[0]!.content.length).toBe(CHAT_LIMITS.contentChars);
    });

    test('a damaged store is an empty list, not a crash; a damaged conversation is an empty chat', async () => {
      const { chats, kv } = store({ async: asyncKv });
      kv.poke('joyorogo.ai.chats', '{oops');
      expect(await chats.list()).toEqual([]);
      const c = await chats.create('ok');
      kv.poke(`joyorogo.ai.chat.${c.id}`, 'garbage');
      expect((await chats.get(c.id))!.messages).toEqual([]);
      kv.poke(`joyorogo.ai.chat.${c.id}`, JSON.stringify({ messages: [{ role: 'user' }, 5, { role: 'user', content: 'ok' }] }));
      expect((await chats.get(c.id))!.messages.map((m) => m.content)).toEqual(['ok']);
    });

    test('concurrent writes do not lose a conversation', async () => {
      const { chats } = store({ async: asyncKv });
      const made = await Promise.all([chats.create('a'), chats.create('b'), chats.create('c')]);
      expect((await chats.list()).map((m) => m.id).sort()).toEqual(made.map((m) => m.id).sort());
    });

    test('subscribers hear every change', async () => {
      const { chats } = store({ async: asyncKv });
      let heard = 0;
      const off = chats.subscribe(() => (heard += 1));
      const c = await chats.create('a');
      await chats.setMessages(c.id, [user('1', 'a')]);
      await chats.remove(c.id);
      off();
      await chats.create('b');
      expect(heard).toBeGreaterThanOrEqual(3);
      const after = heard;
      await chats.create('c');
      expect(heard).toBe(after);
    });
  });
}

describe('messages', () => {
  test('toMessage keeps valid optional fields and drops the rest', () => {
    const m = toMessage({ role: 'assistant', content: 'x', engine: 'nope', provider: 'openai', stopped: true, fixed: 'yes', reasoning: 'r'.repeat(5000), tokens: { input: 1, output: 2 }, steps: [{ tool: 'evil_tool' }, { tool: 'get_targets', args: { a: { b: 1 }, ok: 'yes' }, unknown: true }] }, 'id0', 5)!;
    expect(m).toMatchObject({ id: 'id0', at: 5, provider: 'openai', stopped: true, tokens: { input: 1, output: 2 } });
    expect(m.engine).toBeUndefined();
    expect(m.fixed).toBeUndefined();
    expect(m.reasoning!.length).toBe(CHAT_LIMITS.reasoningChars);
    expect(m.steps).toEqual([{ id: 's1', tool: 'get_targets', args: { ok: 'yes' }, count: null, empty: false, failed: false, notConnected: false, unknown: true }]);
    expect(toMessage({ role: 'system', content: 'x' }, 'i', 0)).toBeNull();
    expect(toMessage({ role: 'assistant', content: 'x', engine: 'hosted' }, 'i', 0)!.engine).toBe('hosted');
  });

  test('chatLines hands the engines role and text only', () => {
    expect(chatLines([user('1', 'a'), bot('2', 'b', { model: 'm', steps: [], reasoning: 'secret thoughts' })])).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]);
  });
});
