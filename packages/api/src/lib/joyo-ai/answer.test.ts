// Ported from JoyoFit (watch-fit) src/features/ai/answer.test.ts, adapted for JoyoRogo (engine-agnostic loop, food tools).
import { describe, expect, test } from 'bun:test';

import { answer, ANSWER_LIMITS, type AnswerDeps } from './answer';
import type { SafetyText } from './safety';
import { adult, fakeToolData, joyoAiStrings, safetyText, sampleSource, scriptedAdapter, textReply, toolReply } from './testFixtures';
import { AiError, type Usage } from './types';

const idAi = joyoAiStrings('id');
const TEXT: SafetyText = safetyText('id');

function setup(opts: { age?: number | null; script?: Parameters<typeof scriptedAdapter>[0]; over?: Partial<AnswerDeps> } = {}) {
  const adapter = scriptedAdapter(opts.script ?? [textReply('Nasi merah lebih tinggi serat.')]);
  const data = fakeToolData();
  const log: string[] = [];
  const after: { usage: Usage | null; ok: boolean }[] = [];
  const deps: AnswerDeps = {
    adapter,
    conn: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-live-ABCDEFGH12345678', model: 'gpt-6-luna' },
    person: { ...adult, ageYears: opts.age === undefined ? 30 : opts.age },
    locale: 'id',
    text: TEXT,
    gather: async () => {
      log.push('gather');
      return sampleSource();
    },
    data,
    beforeCall: () => void log.push('beforeCall'),
    afterCall: (usage, ok) => void after.push({ usage, ok }),
    ...opts.over,
  };
  return { deps, adapter, data, log, after };
}

const ask = (text: string) => [{ role: 'user' as const, content: text }];

describe('safety pass before anything else', () => {
  test('a worrying last message gets the fixed answer: no gather, no beforeCall, no provider call, no usage', async () => {
    const t = setup();
    const out = await answer(ask('tadi hampir pingsan karena lapar'), t.deps);
    expect(out.fixed).toBe(true);
    expect(out.flagged).toBe('medical');
    expect(out.reply).toEndWith(idAi.disclaimerLine);
    expect(out.digest).toBeNull();
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0 });
    expect(t.adapter.requests).toHaveLength(0);
    expect(t.log).toEqual([]);
    expect(t.after).toEqual([]);
  });
  test('eating-disorder signals get the fixed answer with no restriction advice', async () => {
    const t = setup();
    const out = await answer(ask('aku takut makan dan mau muntahin makanan'), t.deps);
    expect(out.fixed).toBe(true);
    expect(out.reply).toContain('tidak akan memberi saran membatasi makan');
    expect(t.adapter.requests).toHaveLength(0);
  });
  test('a minor diet message gets the fixed minor answer', async () => {
    const t = setup({ age: 16 });
    const out = await answer(ask('diet 500 kkal sehari'), t.deps);
    expect(out.fixed).toBe(true);
    expect(out.reply).toContain('di bawah 18');
    expect(t.adapter.requests).toHaveLength(0);
  });
  test('an adult asking for an extreme diet reaches the model with the extreme-diet block, and the reply closes with the caveat', async () => {
    const t = setup({ script: [textReply('Itu terlalu sedikit untuk dijalani sendiri.')] });
    const out = await answer(ask('diet 500 kkal sehari'), t.deps);
    expect(out.fixed).toBe(false);
    expect(t.adapter.requests[0]!.system).toContain('asked about an extreme diet');
    expect(out.reply).toEndWith(idAi.disclaimerLine);
  });
  test('an allergy or condition gets the block and the caveat; a pregnancy mention switches to the conservative block', async () => {
    const t = setup({ script: [textReply('Umumnya porsi kecil.'), textReply('Makanan itu umumnya aman.')] });
    const a = await answer(ask('saya diabetes, boleh makan nasi merah?'), t.deps);
    expect(t.adapter.requests[0]!.system).toContain('named an allergy or a health condition');
    expect(a.reply).toEndWith(idAi.disclaimerLine);
    const b = await answer(ask('saya hamil boleh makan ini?'), t.deps);
    expect(t.adapter.requests[1]!.system).toContain('Be conservative');
    expect(b.reply).toEndWith(idAi.disclaimerLine);
  });
});

describe('order: safety, beforeCall, digest, calls', () => {
  test('beforeCall runs before the digest is gathered and before every provider call', async () => {
    const t = setup({ script: [toolReply({ id: 'c1', name: 'get_targets', args: {} }), textReply('Targetmu 1.800 kkal.')], over: undefined });
    await answer(ask('berapa targetku?'), t.deps);
    expect(t.log).toEqual(['beforeCall', 'gather', 'beforeCall']);
  });
  test('beforeCall can block: no digest, no provider call', async () => {
    const t = setup({
      over: {
        beforeCall: () => {
          throw new AiError('blocked', null, 'ceiling');
        },
      },
    });
    await expect(answer(ask('hai'), t.deps)).rejects.toMatchObject({ kind: 'blocked', detail: 'ceiling' });
    expect(t.adapter.requests).toHaveLength(0);
    expect(t.log).toEqual([]);
  });
  test('a ceiling reached in the middle of a tool loop stops before the next provider call', async () => {
    let allowed = 1;
    const t = setup({
      script: [toolReply({ id: 'c1', name: 'get_targets', args: {} }), textReply('ok')],
      over: {
        beforeCall: () => {
          if (allowed-- <= 0) throw new AiError('blocked', null, 'ceiling');
        },
      },
    });
    await expect(answer(ask('hai'), t.deps)).rejects.toMatchObject({ kind: 'blocked', detail: 'ceiling' });
    expect(t.adapter.requests).toHaveLength(1);
  });
});

describe('answer loop', () => {
  test('a plain answer: digest and food block in the system prompt, one call, afterCall with usage', async () => {
    const t = setup({ over: { preseed: async () => 'FOOD DATA (ours)\nnasi merah: 1.8 g fiber per 100 g' } });
    const out = await answer(ask('Lebih baik nasi merah atau nasi putih?'), t.deps);
    expect(out.reply).toBe('Nasi merah lebih tinggi serat.');
    expect(out.usage).toEqual({ inputTokens: 1000, outputTokens: 80, calls: 1 });
    expect(t.after).toEqual([{ usage: { inputTokens: 1000, outputTokens: 80 }, ok: true }]);
    const request = t.adapter.requests[0]!;
    expect(request.system).toContain('"v":1');
    expect(request.system).toContain('FOOD DATA (ours)');
    expect(request.system).toContain('kamu');
    expect(request.tools?.map((x) => x.name)).toContain('compare_foods');
    expect(request.maxTokens).toBe(ANSWER_LIMITS.maxTokens);
    expect(t.adapter.conns[0]).toMatchObject({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna' });
    expect(out.digest).not.toBeNull();
  });

  test('the food block gets the last user message; a preseed failure is ignored', async () => {
    const seen: string[] = [];
    const ok = setup({ over: { preseed: async (text) => (seen.push(text), null) } });
    await answer([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'pepaya atau melon?' }], ok.deps);
    expect(seen).toEqual(['pepaya atau melon?']);
    const broken = setup({
      over: {
        preseed: async () => {
          throw new Error('boom');
        },
      },
    });
    const out = await answer(ask('pepaya atau melon?'), broken.deps);
    expect(out.reply).toBe('Nasi merah lebih tinggi serat.');
    expect(broken.adapter.requests[0]!.system).not.toContain('FOOD DATA (ours)');
  });

  test('a tool round trip: the read-only call runs, its result goes back, the trace and steps are kept', async () => {
    const t = setup({ script: [toolReply({ id: 'c1', name: 'get_day', args: { date: '2026-10-22' } }), textReply('Sisa 1.605 kkal hari ini.')] });
    const events: string[] = [];
    const out = await answer(ask('Sisa kkal hari ini?'), { ...t.deps, onEvent: (e) => events.push(e.type === 'toolDone' ? `${e.type}:${e.trace.tool}:${e.summary.count}` : e.type) });
    expect(out.reply).toBe('Sisa 1.605 kkal hari ini.');
    expect(out.trace).toEqual([{ tool: 'get_day', args: { date: '2026-10-22' } }]);
    expect(events).toEqual(['round', 'toolStart', 'toolDone:get_day:1', 'round']);
    expect(out.steps).toHaveLength(1);
    expect(out.steps[0]).toMatchObject({ id: 'c1', trace: { tool: 'get_day' }, summary: { count: 1, empty: false, failed: false } });
    const second = t.adapter.requests[1]!.messages;
    expect(second.at(-2)).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'c1', name: 'get_day' }] });
    expect(second.at(-1)).toMatchObject({ role: 'tool', callId: 'c1' });
    expect(t.data.calls).toContain('day 2026-10-22');
    expect(out.usage.calls).toBe(2);
  });

  test('a bad or unknown tool call is a failed step, never a throw', async () => {
    const t = setup({ script: [toolReply({ id: 'c1', name: 'delete_everything', args: {} }, { id: 'c2', name: 'get_day', args: { date: 'kemarin' } }), textReply('Maaf, tidak bisa membaca itu.')] });
    const out = await answer(ask('hapus semua'), t.deps);
    expect(out.steps.map((s) => s.summary.failed)).toEqual([true, true]);
    expect(t.data.calls).toEqual([]);
  });

  test('tool rounds are limited: after the limit the model is asked to answer without tools', async () => {
    const loop = Array.from({ length: ANSWER_LIMITS.toolRounds }, (_, i) => toolReply({ id: `c${i}`, name: 'get_targets', args: {} }));
    const t = setup({ script: [...loop, textReply('Cukup, ini jawabanku.')] });
    const out = await answer(ask('lihat semuanya'), t.deps);
    expect(out.reply).toBe('Cukup, ini jawabanku.');
    expect(out.trace).toHaveLength(ANSWER_LIMITS.toolRounds);
    expect(t.adapter.requests).toHaveLength(ANSWER_LIMITS.toolRounds + 1);
    expect(t.adapter.requests.at(-1)!.tools).toBeUndefined();
  });

  test('at most 4 tool calls run per round', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: 'get_targets', args: {} }));
    const t = setup({ script: [toolReply(...many), textReply('ok')] });
    const out = await answer(ask('banyak'), t.deps);
    expect(out.trace).toHaveLength(ANSWER_LIMITS.toolCallsPerRound);
  });

  test('toolsEnabled=false: digest and food block only, no tools sent, flagged as unsupported', async () => {
    const t = setup({ over: { toolsEnabled: false } });
    const out = await answer(ask('tidur?'), t.deps);
    expect(out.toolsUnsupported).toBe(true);
    expect(t.adapter.requests[0]!.tools).toBeUndefined();
    expect(t.adapter.requests[0]!.system).not.toContain('compare_foods');
  });

  test('a model without tool calling: falls back, tells the caller once', async () => {
    let told = 0;
    const t = setup({ script: [new AiError('noTools', 400, 'no tools'), textReply('Dari data saja.')], over: { onNoTools: () => void (told += 1) } });
    const out = await answer(ask('tidur?'), t.deps);
    expect(out.toolsUnsupported).toBe(true);
    expect(told).toBe(1);
    expect(t.adapter.requests[0]!.tools).toBeDefined();
    expect(t.adapter.requests[1]!.tools).toBeUndefined();
    expect(t.after.map((x) => x.ok)).toEqual([false, true]);
  });

  test('provider errors reach the caller as AiError and an answer-less reply is an empty error', async () => {
    const bad = setup({ script: [new AiError('badKey', 401, 'x')] });
    await expect(answer(ask('hai'), bad.deps)).rejects.toMatchObject({ kind: 'badKey' });
    expect(bad.after).toEqual([{ usage: null, ok: false }]);
    const empty = setup({ script: [textReply('   ')] });
    await expect(answer(ask('hai'), empty.deps)).rejects.toMatchObject({ kind: 'empty' });
  });

  test('the conversation is cut to the last 12 turns and each turn to 2,000 characters', async () => {
    const t = setup();
    const long = Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `${i} ${'x'.repeat(3000)}` }));
    await answer([...long, { role: 'user', content: 'terakhir' }], t.deps);
    const sent = t.adapter.requests[0]!.messages;
    expect(sent.length).toBeLessThanOrEqual(ANSWER_LIMITS.turns);
    for (const m of sent) if (m.role !== 'tool') expect(m.content.length).toBeLessThanOrEqual(2000);
    expect(sent[0]!.role).toBe('user');
  });

  test('older answers are cut, the last two turns are whole', async () => {
    const t = setup();
    const long = 'x'.repeat(1500);
    await answer([{ role: 'user', content: 'q1' }, { role: 'assistant', content: long }, { role: 'user', content: 'q2' }, { role: 'assistant', content: long }, { role: 'user', content: 'q3' }], t.deps);
    const sent = t.adapter.requests[0]!.messages.map((m) => (m.role === 'assistant' ? m.content.length : 0));
    expect(sent[1]).toBe(ANSWER_LIMITS.oldAnswerChars + 3);
    expect(sent[3]).toBe(1500);
  });

  test('the key goes only to the adapter connection, never into the prompt or the messages', async () => {
    const t = setup();
    await answer(ask('hai'), t.deps);
    expect(JSON.stringify(t.adapter.requests)).not.toContain('sk-live');
    expect(t.adapter.conns[0]!.apiKey).toBe('sk-live-ABCDEFGH12345678');
  });

  test('a thinking model that ran out of budget gets one more try with more room, counted as a call', async () => {
    const t = setup({ script: [new AiError('truncated', 200, 'finish_reason=length'), textReply('Ini jawabannya.')] });
    const out = await answer(ask('review hari ini'), t.deps);
    expect(out.reply).toBe('Ini jawabannya.');
    expect(t.adapter.requests.map((r) => r.maxTokens)).toEqual([ANSWER_LIMITS.maxTokens, ANSWER_LIMITS.maxTokensRetry]);
    expect(t.log.filter((x) => x === 'beforeCall')).toHaveLength(2);
  });

  test('the reasoning of the answer is kept apart from the reply; markup-only is an empty error', async () => {
    const t = setup({ script: [{ ...textReply('Cukup.'), thinking: 'Lihat target dulu.' }] });
    const out = await answer(ask('cukup?'), t.deps);
    expect(out.reply).toBe('Cukup.');
    expect(out.reasoning).toBe('Lihat target dulu.');
    const markup = setup({ script: [textReply('<think>hmm</think>')] });
    await expect(answer(ask('cukup?'), markup.deps)).rejects.toMatchObject({ kind: 'empty' });
  });

  test('English and Malay answers use their language block', async () => {
    const en = setup({ over: { locale: 'en' } });
    await answer(ask('which has more fiber?'), en.deps);
    expect(en.adapter.requests[0]!.system).toContain('"kcal"');
    const ms = setup({ over: { locale: 'ms' } });
    await answer(ask('yang mana lebih tinggi serat?'), ms.deps);
    expect(ms.adapter.requests[0]!.system).toContain('Malaysian Malay');
  });
});
