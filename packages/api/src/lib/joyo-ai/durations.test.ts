// Ported from JoyoFit (watch-fit) src/features/ai/durations.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import { formatDurations, hoursAndMinutes } from './durations';

describe('durations read as hours and minutes', () => {
  test('English and Indonesian', () => {
    expect(formatDurations("you're carrying 684 minutes of missed sleep", 'en')).toBe("you're carrying 11h 24m of missed sleep");
    expect(formatDurations('utang tidur 684 menit', 'id')).toBe('utang tidur 11 jam 24 menit');
    expect(formatDurations('402 min tidur, 311 mins', 'en')).toBe('6h 42m tidur, 5h 11m');
    expect(formatDurations('120 menit latihan', 'id')).toBe('2 jam latihan');
    expect(formatDurations('a 311-minute sleep night', 'en')).toBe('a 5h 11m sleep night');
  });
  test('short ones, other numbers and words stay as written', () => {
    expect(formatDurations('45 minutes of walking, 89 menit', 'en')).toBe('45 minutes of walking, 89 menit');
    expect(formatDurations('1,200 minutes', 'en')).toBe('1,200 minutes');
    expect(formatDurations('7 minutes 684', 'en')).toBe('7 minutes 684');
    expect(formatDurations('120 minuter', 'en')).toBe('120 minuter');
    expect(formatDurations('', 'id')).toBe('');
  });
  test('hoursAndMinutes', () => {
    expect(hoursAndMinutes(90, 'en')).toBe('1h 30m');
    expect(hoursAndMinutes(60, 'id')).toBe('1 jam');
  });
});

describe('Malay', () => {
  test('minit becomes jam and minit', () => {
    expect(formatDurations('Berpuasa 990 minit', 'ms')).toBe('Berpuasa 16 jam 30 minit');
    expect(hoursAndMinutes(120, 'ms')).toBe('2 jam');
  });
});
