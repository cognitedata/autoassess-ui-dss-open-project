import { create } from 'zustand';

interface PcdVisibilityState {
  visibility: Record<string, boolean>;
  /** Initialise keys to hidden if not already set. Idempotent. */
  initPcdKeys(keys: string[]): void;
  setPcdVisible(key: string, visible: boolean): void;
  /** Returns true unless the key has been explicitly set to false. */
  isPcdVisible(key: string): boolean;
}

export const usePcdVisibilityStore = create<PcdVisibilityState>((set, get) => ({
  visibility: {},

  initPcdKeys(keys: string[]): void {
    set((state) => {
      const next = { ...state.visibility };
      for (const key of keys) {
        if (next[key] === undefined) next[key] = false;
      }
      return { visibility: next };
    });
  },

  setPcdVisible(key: string, visible: boolean): void {
    set((state) => ({ visibility: { ...state.visibility, [key]: visible } }));
  },

  isPcdVisible(key: string): boolean {
    return get().visibility[key] === true;
  },
}));
