// Ported from JoyoFit (watch-fit) src/features/ai/ui/chatState.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import type { AnswerEvent } from './answer';
import {
  assistantMessage,
  createCoalescer,
  displayTitle,
  distanceFromBottom,
  initialLive,
  isNearBottom,
  JUMP_ROOM_PX,
  lastIndexOfRole,
  liveStatus,
  NEAR_BOTTOM_PX,
  nextAway,
  partialOnStop,
  plainArgs,
  reduceLive,
  roomShift,
  shiftOnGrowth,
  splitStable,
  stepCall,
  stepLabel,
  stepState,
  toStepRecords,
  type LiveState,
  type Translate,
} from './chat-state';
import type { ToolTrace } from './tools';
import type { ChatMessage } from './conversations';
import { joyoAiStrings } from './testFixtures';

/** A tiny `t` over one locale file with `{{x}}` interpolation: the same contract i18next gives the UIs. */
const translator =
  (ai: Record<string, unknown>): Translate =>
  (key, options = {}) => {
    const line = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], ai);
    return String(line).replace(/{{(\w+)}}/g, (_, name: string) => String(options[name] ?? ''));
  };
const tId = translator(joyoAiStrings('id'));
const tEn = translator(joyoAiStrings('en'));
const tMs = translator(joyoAiStrings('ms'));

const apply = (events: AnswerEvent[], from: LiveState = initialLive()): LiveState => events.reduce(reduceLive, from);

const RANGE = { tool: 'get_range', args: { from: '2026-10-01', to: '2026-10-14' } } as const;
const DONE = { count: 14, empty: false, failed: false, notConnected: false, unknown: false };
const FOODS = { tool: 'compare_foods', args: { foods: ['pepaya', 'melon', 'semangka'] } } satisfies ToolTrace;

describe('reduceLive', () => {
  test('text and reasoning deltas accumulate', () => {
    const s = apply([
      { type: 'round', round: 1 },
      { type: 'reasoning', delta: 'Cek ' },
      { type: 'reasoning', delta: 'tidur.' },
      { type: 'text', delta: 'Tidurmu ' },
      { type: 'text', delta: 'cukup.' },
    ]);
    expect(s.text).toBe('Tidurmu cukup.');
    expect(s.reasoning).toBe('Cek tidur.');
    expect(s.round).toBe(1);
  });

  test('a new round clears the preamble text but keeps steps and reasoning', () => {
    const s = apply([
      { type: 'round', round: 1 },
      { type: 'reasoning', delta: 'Perlu data.' },
      { type: 'text', delta: 'Aku cek dulu ya.' },
      { type: 'toolStart', id: 't1', trace: { tool: 'get_day', args: {} } },
      { type: 'toolDone', id: 't1', trace: RANGE, summary: DONE },
      { type: 'round', round: 2 },
    ]);
    expect(s.text).toBe('');
    expect(s.steps).toHaveLength(1);
    expect(s.reasoning).toBe('Perlu data.\n\n');
    expect(apply([{ type: 'reasoning', delta: 'Sudah.' }], s).reasoning).toBe('Perlu data.\n\nSudah.');
    expect(s.round).toBe(2);
  });

  test('a tool runs, then ends with its arguments and summary', () => {
    const started = apply([{ type: 'toolStart', id: 't1', trace: { tool: 'get_day', args: {} } }]);
    expect(started.steps).toEqual([expect.objectContaining({ id: 't1', tool: 'get_day', running: true, count: null })]);
    const ended = reduceLive(started, { type: 'toolDone', id: 't1', trace: RANGE, summary: DONE });
    expect(ended.steps).toEqual([{ id: 't1', tool: 'get_range', args: RANGE.args, count: 14, empty: false, failed: false, notConnected: false, unknown: false, running: false }]);
  });

  test('a repeated start does not add a second step, and a done without a start still shows', () => {
    const s = apply([
      { type: 'toolStart', id: 't1', trace: { tool: 'get_targets', args: {} } },
      { type: 'toolStart', id: 't1', trace: { tool: 'get_targets', args: {} } },
      { type: 'toolDone', id: 't2', trace: { tool: 'get_targets', args: {} }, summary: { count: null, empty: true, failed: false, notConnected: false, unknown: false } },
    ]);
    expect(s.steps.map((x) => x.id)).toEqual(['t1', 't2']);
    expect(s.steps[1]!.empty).toBe(true);
  });

  test('reasoning is capped', () => {
    const s = apply([{ type: 'reasoning', delta: 'x'.repeat(10_000) }]);
    expect(s.reasoning.length).toBe(6_000);
  });

  test('the input state is not mutated', () => {
    const before = initialLive();
    reduceLive(before, { type: 'text', delta: 'a' });
    expect(before).toEqual(initialLive());
  });
});

describe('liveStatus', () => {
  test('a running tool wins, then reasoning without text, then writing', () => {
    const running = apply([{ type: 'toolStart', id: 't1', trace: { tool: 'get_targets', args: {} } }]);
    expect(liveStatus(running).kind).toBe('tool');
    expect(liveStatus(apply([{ type: 'reasoning', delta: 'hm' }])).kind).toBe('reasoning');
    expect(liveStatus(apply([{ type: 'reasoning', delta: 'hm' }, { type: 'text', delta: 'a' }])).kind).toBe('writing');
    expect(liveStatus(initialLive()).kind).toBe('writing');
  });
});

describe('stopping', () => {
  test('keeps the partial text with the steps that finished, marked stopped', () => {
    const s = apply([
      { type: 'toolStart', id: 't1', trace: RANGE },
      { type: 'toolDone', id: 't1', trace: RANGE, summary: DONE },
      { type: 'toolStart', id: 't2', trace: { tool: 'get_targets', args: {} } },
      { type: 'text', delta: '  Tidurmu kemarin ' },
    ]);
    const partial = partialOnStop(s);
    expect(partial).not.toBeNull();
    const message = assistantMessage({ id: 'm1', at: 5, engine: 'byok', model: 'm', ...partial! });
    expect(message.content).toBe('Tidurmu kemarin');
    expect(message.stopped).toBe(true);
    // The tool that never finished is not stored.
    expect(message.steps?.map((x) => x.id)).toEqual(['t1']);
  });

  test('drops everything when no text arrived', () => {
    expect(partialOnStop(apply([{ type: 'toolStart', id: 't1', trace: RANGE }, { type: 'reasoning', delta: 'hm' }]))).toBeNull();
    expect(partialOnStop(apply([{ type: 'text', delta: '   ' }]))).toBeNull();
  });
});

describe('assistantMessage and steps', () => {
  test('converts answer steps to records and leaves empty fields out', () => {
    const steps = toStepRecords([{ id: 'a', trace: RANGE, summary: { count: null, empty: false, failed: true, notConnected: false, unknown: false } }]);
    expect(steps).toEqual([{ id: 'a', tool: 'get_range', args: RANGE.args, count: null, empty: false, failed: true, notConnected: false, unknown: false }]);
    const message = assistantMessage({ id: 'm', at: 1, content: 'Halo', engine: 'hosted', steps: [], reasoning: '  ', tokens: { input: 0, output: 0 } });
    expect(message).toEqual({ id: 'm', role: 'assistant', content: 'Halo', at: 1, engine: 'hosted' });
  });

  test('keeps tokens, reasoning and the fixed flag when present', () => {
    const message = assistantMessage({
      id: 'm',
      at: 1,
      content: 'Halo',
      engine: 'byok',
      provider: 'openai',
      model: 'gpt-x',
      reasoning: ' pikir ',
      tokens: { input: 10, output: 5 },
      fixed: true,
    });
    expect(message).toMatchObject({ provider: 'openai', model: 'gpt-x', reasoning: 'pikir', tokens: { input: 10, output: 5 }, fixed: true });
  });
});

describe('createCoalescer', () => {
  function fakeClock() {
    let now = 1_000;
    let seq = 0;
    const timers = new Map<number, { at: number; run: () => void }>();
    return {
      clock: {
        now: () => now,
        setTimer: (run: () => void, ms: number) => {
          seq += 1;
          timers.set(seq, { at: now + ms, run });
          return seq;
        },
        clearTimer: (h: unknown) => void timers.delete(h as number),
      },
      advance(ms: number) {
        now += ms;
        for (const [id, timer] of [...timers]) {
          if (timer.at <= now) {
            timers.delete(id);
            timer.run();
          }
        }
      },
      pending: () => timers.size,
    };
  }

  test('the first change shows at once, then many schedules inside one interval commit once', () => {
    const f = fakeClock();
    let commits = 0;
    const c = createCoalescer(() => (commits += 1), 50, f.clock);
    c.schedule();
    f.advance(0);
    expect(commits).toBe(1);
    for (let i = 0; i < 100; i += 1) c.schedule();
    expect(f.pending()).toBe(1);
    f.advance(49);
    expect(commits).toBe(1);
    f.advance(1);
    expect(commits).toBe(2);
  });

  test('after a commit the next one waits out the rest of the interval', () => {
    const f = fakeClock();
    let commits = 0;
    const c = createCoalescer(() => (commits += 1), 50, f.clock);
    c.schedule();
    f.advance(0);
    expect(commits).toBe(1);
    f.advance(20);
    c.schedule();
    f.advance(29);
    expect(commits).toBe(1);
    f.advance(1);
    expect(commits).toBe(2);
  });

  test('flush commits now and clears the pending timer; cancel drops it', () => {
    const f = fakeClock();
    let commits = 0;
    const c = createCoalescer(() => (commits += 1), 50, f.clock);
    c.schedule();
    c.flush();
    expect(commits).toBe(1);
    expect(f.pending()).toBe(0);
    c.schedule();
    c.cancel();
    f.advance(500);
    expect(commits).toBe(1);
  });
});

describe('step words', () => {
  const view = (tool: Parameters<typeof stepLabel>[0]['tool'], args: Record<string, string | number>, over: Partial<Parameters<typeof stepLabel>[0]> = {}) => ({ tool, args, running: false, empty: false, unknown: false, failed: false, ...over });

  test('a finished step, a running step and a step with nothing found use the three lines', () => {
    expect(stepLabel(view('get_day', { date: '2026-10-22' }), tId)).toBe('Membaca catatan makan 2026-10-22');
    expect(stepLabel(view('get_day', { date: '2026-10-22' }, { running: true }), tEn)).toBe('Reading food log for 2026-10-22...');
    expect(stepLabel(view('get_day', { date: '2026-10-22' }, { empty: true }), tMs)).toBe('Tiada catatan makan 2026-10-22');
    expect(stepLabel(view('get_range', { from: '2026-10-01', to: '2026-10-14' }), tEn)).toBe('Read log from 2026-10-01 to 2026-10-14');
    expect(stepLabel(view('get_weight_trend', { days: 30 }), tId)).toBe('Membaca tren berat 30 hari');
    expect(stepLabel(view('compare_foods', { foods: 'pepaya, melon' }), tEn)).toBe('Compared pepaya, melon');
    expect(stepLabel(view('search_foods', { foods: 'zzz' }, { unknown: true }), tEn)).toBe('zzz not found');
  });

  test('a step that just started has no arguments: the gaps close up', () => {
    expect(stepLabel(view('get_day', {}, { running: true }), tId)).toBe('Membaca catatan makan...');
    expect(stepLabel(view('fits_today', {}, { running: true }), tEn)).toBe('Checking against what is left today...');
  });

  test('a failed step uses the none line (the screen adds its own mark)', () => {
    expect(stepLabel(view('get_targets', {}, { failed: true }), tEn)).toBe('Targets are not set');
    expect(stepState(view('get_targets', {}, { failed: true }))).toBe('failed');
    expect(stepState(view('get_targets', {}, { running: true }))).toBe('running');
    expect(stepState(view('get_targets', {}, { unknown: true }))).toBe('none');
    expect(stepState(view('get_targets', {}))).toBe('done');
  });

  test('every tool has all three lines in all three languages', () => {
    const tools = ['get_day', 'get_range', 'get_weight_trend', 'get_targets', 'search_foods', 'compare_foods', 'fits_today'] as const;
    for (const t of [tId, tEn, tMs]) {
      for (const tool of tools) {
        for (const over of [{ running: true }, {}, { empty: true }]) expect(stepLabel(view(tool, {}, over), t)).not.toMatch(/steps\.|undefined|\{\{/);
      }
    }
  });

  test('food lists are joined for the record and the exact call shows names, never values', () => {
    expect(plainArgs(FOODS.args)).toEqual({ foods: 'pepaya, melon, semangka' });
    expect(stepCall({ tool: 'compare_foods', args: plainArgs(FOODS.args) })).toBe('compare_foods(foods=pepaya, melon, semangka)');
    expect(stepCall({ tool: 'get_targets', args: {} })).toBe('get_targets()');
  });
});

describe('conversation helpers', () => {
  test('the title falls back while it is empty', () => {
    expect(displayTitle('', 'Percakapan baru')).toBe('Percakapan baru');
    expect(displayTitle('  ', 'Percakapan baru')).toBe('Percakapan baru');
    expect(displayTitle('Tidur', 'Percakapan baru')).toBe('Tidur');
  });

  test('finds the last message of a role', () => {
    const m = (role: ChatMessage['role']): ChatMessage => ({ id: role, role, content: 'x', at: 0 });
    expect(lastIndexOfRole([m('user'), m('assistant'), m('user')], 'user')).toBe(2);
    expect(lastIndexOfRole([m('user'), m('assistant')], 'assistant')).toBe(1);
    expect(lastIndexOfRole([], 'user')).toBe(-1);
  });
});

describe('near the bottom', () => {
  const at = (offsetY: number) => ({ offsetY, viewportH: 600, contentH: 2_000 });

  test('distance from the end', () => {
    expect(distanceFromBottom(at(1_400))).toBe(0);
    expect(distanceFromBottom(at(1_000))).toBe(400);
    // Overscroll never reads as negative.
    expect(distanceFromBottom(at(1_500))).toBe(0);
  });

  test('the threshold is inclusive', () => {
    expect(isNearBottom(at(1_400 - NEAR_BOTTOM_PX))).toBe(true);
    expect(isNearBottom(at(1_400 - NEAR_BOTTOM_PX - 1))).toBe(false);
    expect(isNearBottom(at(1_000), 500)).toBe(true);
  });

  test('a chat shorter than the screen is at the bottom', () => {
    expect(isNearBottom({ offsetY: 0, viewportH: 600, contentH: 300 })).toBe(true);
  });
});

describe('splitStable (the settled part of streaming text)', () => {
  test('splits at the last blank line; the tail is the paragraph still being written', () => {
    expect(splitStable('Satu.\n\nDua.\n\nTiga sedang')).toEqual({ head: 'Satu.\n\nDua.', tail: 'Tiga sedang' });
    expect(splitStable('Satu saja')).toEqual({ head: '', tail: 'Satu saja' });
    expect(splitStable('')).toEqual({ head: '', tail: '' });
    expect(splitStable('\n\nawal')).toEqual({ head: '', tail: '\n\nawal' });
  });
  test('a blank line inside an open code fence is not a split point', () => {
    expect(splitStable('Intro\n\n```\nkode\n\nlagi')).toEqual({ head: 'Intro', tail: '```\nkode\n\nlagi' });
    expect(splitStable('Intro\n\n```\nkode\n```\n\nSesudah')).toEqual({ head: 'Intro\n\n```\nkode\n```', tail: 'Sesudah' });
  });
  test('head and tail together always hold every character apart from the blank lines between them', () => {
    const text = '# Judul\n\n- a\n- b\n\n1. satu\n\n2. dua\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\nAkhir';
    for (let n = 1; n <= text.length; n++) {
      const { head, tail } = splitStable(text.slice(0, n));
      expect((head + tail).replace(/\n/g, '')).toBe(text.slice(0, n).replace(/\n/g, ''));
    }
  });
  test('the split point only moves forward as text grows (so the settled part is never redrawn)', () => {
    const text = 'A.\n\nB.\n\nC.\n\nD sedang ditulis';
    let last = 0;
    for (let n = 1; n <= text.length; n++) {
      const { head } = splitStable(text.slice(0, n));
      expect(head.length).toBeGreaterThanOrEqual(last);
      last = head.length;
    }
  });
});

describe('away from the newest message', () => {
  test('hysteresis: away past 160 px, back only within 80 px', () => {
    expect(nextAway(false, 100)).toBe(false);
    expect(nextAway(false, 161)).toBe(true);
    expect(nextAway(true, 120)).toBe(true);
    expect(nextAway(true, 80)).toBe(false);
    expect(nextAway(true, 0)).toBe(false);
  });
  test('the list moves for growth only when the person reads older text and the newest message is what changed', () => {
    const base = { prev: 1000, next: 1400, offset: 600, away: true, windowOpen: true };
    expect(shiftOnGrowth(base)).toBe(400);
    expect(shiftOnGrowth({ ...base, away: false })).toBe(0);
    expect(shiftOnGrowth({ ...base, windowOpen: false })).toBe(0);
    expect(shiftOnGrowth({ ...base, offset: 0 })).toBe(0);
    expect(shiftOnGrowth({ ...base, next: 900 })).toBe(0);
    expect(shiftOnGrowth({ ...base, prev: 0 })).toBe(0);
  });
  test('the room under the newest message for the jump button is followed by the offset, in both directions', () => {
    expect(roomShift(JUMP_ROOM_PX)).toBe(JUMP_ROOM_PX);
    expect(roomShift(-JUMP_ROOM_PX)).toBe(-JUMP_ROOM_PX);
    expect(roomShift(400)).toBe(0);
    expect(roomShift(0)).toBe(0);
  });
});
