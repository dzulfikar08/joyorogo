import { createContext, useContext } from 'react';

import type { ScrubStore } from './scrub';
import type { AnalysisT } from './text';
import type { AnalysisPalette } from './theme';

export interface AnalysisContextValue {
  palette: AnalysisPalette;
  t: AnalysisT;
  store: ScrubStore;
  /** Tells the host a chart or map gesture owns the touch (lock the surrounding scroll view). */
  setScrubActive: (active: boolean) => void;
}

export const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function useAnalysisContext(): AnalysisContextValue {
  const value = useContext(AnalysisContext);
  if (!value) throw new Error('Analysis components must render inside WorkoutAnalysisView or BasicDetail');
  return value;
}
