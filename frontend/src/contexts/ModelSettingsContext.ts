import { createContext, useContext } from 'react';

export const ModelSettingsContext = createContext<{
  activeModel: string | null;
  setActiveModel: (model: string) => void;
}>({ activeModel: null, setActiveModel: () => undefined });

export function useModelSettings() {
  return useContext(ModelSettingsContext);
}
