import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import type { ReactNode } from 'react';

// @cognite/app-sdk's CogniteSdkProvider performs a Comlink handshake with the Fusion
// host (unavailable in tests) and its useCogniteSdk() throws outside that provider.
// Stub both so hooks using the default (non-overridden) DI dep don't crash render;
// tests that care about the sdk override the relevant UseXContext.Provider directly.
vi.mock('@cognite/app-sdk/react', () => ({
  CogniteSdkProvider: ({ children }: { children: ReactNode }) => children,
  useCogniteSdk: vi.fn(() => ({})),
}));
