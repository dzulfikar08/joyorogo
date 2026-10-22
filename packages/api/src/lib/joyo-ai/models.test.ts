// Ported from JoyoFit (watch-fit) src/features/ai/models.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import { resolveModel, searchModels } from './models';

const list = (...ids: string[]) => ids.map((id) => ({ id, tools: null }));

describe('model resolution: the provider list decides, so a retired default never blocks setup', () => {
  test('keeps the choice when the list has it, else the preset default, else a suggested one, else asks', () => {
    expect(resolveModel('openai', 'gpt-6.1-sol', list('gpt-6.1-sol', 'gpt-6-luna'))).toBe('gpt-6.1-sol');
    expect(resolveModel('openai', 'gone', list('gpt-6-luna'))).toBe('gpt-6-luna');
    expect(resolveModel('openai', null, list('gpt-6.1-sol'))).toBe('gpt-6.1-sol');
    expect(resolveModel('openai', null, list('something-else'))).toBeNull();
  });
  test('without a list (a gateway that has none) the choice or the default is used', () => {
    expect(resolveModel('anthropic', null, [])).toBe('claude-haiku-5-5');
    expect(resolveModel('custom', 'llama3.1', [])).toBe('llama3.1');
    expect(resolveModel('custom', null, [])).toBeNull();
  });
  test('search matches every word, tool-capable first', () => {
    const models = [
      { id: 'anthropic/claude-haiku-5.5', tools: true },
      { id: 'anthropic/claude-haiku-old', tools: false },
      { id: 'openai/gpt-6-luna', tools: true },
    ];
    expect(searchModels(models, 'haiku claude').map((m) => m.id)).toEqual(['anthropic/claude-haiku-5.5', 'anthropic/claude-haiku-old']);
    expect(searchModels(models, 'zzz')).toEqual([]);
    expect(searchModels(models, '', 2)).toHaveLength(2);
  });
});
