// Ported from JoyoFit (watch-fit) src/features/ai/models.ts, adapted for JoyoRogo.
import { PROVIDERS } from './providers';
import type { ModelInfo, ProviderId } from './types';

/**
 * The model to use after the provider's own list is known: the person's choice if the list has it, else the preset's default if
 * the list has it, else the first suggested one the list has, else null (the picker then asks). A retired model name never blocks
 * setup because the list decides.
 */
export function resolveModel(provider: ProviderId, chosen: string | null, list: readonly ModelInfo[]): string | null {
  if (list.length === 0) return chosen ?? (PROVIDERS[provider].defaultModel || null);
  const has = (id: string | null | undefined): id is string => !!id && list.some((m) => m.id === id);
  if (has(chosen)) return chosen;
  const preset = PROVIDERS[provider];
  if (has(preset.defaultModel)) return preset.defaultModel;
  return preset.suggested.find(has) ?? null;
}

/** Models matching what the person typed (id contains every word), tool-capable first, at most `limit`. */
export function searchModels(list: readonly ModelInfo[], query: string, limit = 8): ModelInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list
    .filter((m) => words.every((w) => m.id.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.tools === true) - Number(a.tools === true) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
