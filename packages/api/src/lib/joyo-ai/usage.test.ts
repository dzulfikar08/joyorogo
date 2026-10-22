// New for JoyoRogo: the pure per-day counter behind the own-key daily ceiling.
import { describe, expect, test } from 'bun:test';

import { emptyUsage, recordUsage, todayUsage } from './usage';

describe('usage counter', () => {
  test('counts calls and tokens for the day; an unreported call still counts', () => {
    let state = recordUsage(null, '2026-10-22', { inputTokens: 900, outputTokens: 80 });
    state = recordUsage(state, '2026-10-22', null);
    expect(state).toEqual({ day: '2026-10-22', calls: 2, inputTokens: 900, outputTokens: 80 });
    expect(todayUsage(state, '2026-10-22').calls).toBe(2);
  });
  test('a new day starts from zero; damaged state is zero', () => {
    const old = recordUsage(null, '2026-10-22', { inputTokens: 5, outputTokens: 5 });
    expect(todayUsage(old, '2026-10-23')).toEqual(emptyUsage('2026-10-23'));
    expect(recordUsage(old, '2026-10-23', null).calls).toBe(1);
    expect(todayUsage({ day: 5 }, '2026-10-23')).toEqual(emptyUsage('2026-10-23'));
    expect(recordUsage('junk', '2026-10-23', null).calls).toBe(1);
  });
});
