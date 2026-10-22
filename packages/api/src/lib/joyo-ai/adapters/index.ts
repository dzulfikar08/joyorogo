// Ported from JoyoFit (watch-fit) src/features/ai/adapters/index.ts, adapted for JoyoRogo.
import type { Adapter, AdapterKind } from '../types';
import { anthropicAdapter } from './anthropic';
import { openAiAdapter } from './openai';

export const ADAPTERS: Record<AdapterKind, Adapter> = { openai: openAiAdapter, anthropic: anthropicAdapter };
