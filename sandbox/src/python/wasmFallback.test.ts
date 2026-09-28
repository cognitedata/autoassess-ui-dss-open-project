import { describe, expect, it, vi } from 'vitest';

import type { WasmApi } from './wasmFallback';
import { installWasmMimeFallback } from './wasmFallback';

describe(installWasmMimeFallback.name, () => {
  it('should use streaming compilation when it works', async () => {
    const api = fakeApi();
    installWasmMimeFallback(api.wasm);

    const result = await api.wasm.instantiateStreaming(Promise.resolve(new Response('x')), {});

    expect(result).toBe(api.streamed);
    expect(api.instantiate).not.toHaveBeenCalled();
  });

  it('should fall back to bytes when the MIME type is wrong (TypeError)', async () => {
    const api = fakeApi(new TypeError("Incorrect response MIME type. Expected 'application/wasm'."));
    installWasmMimeFallback(api.wasm);

    const result = await api.wasm.instantiateStreaming(Promise.resolve(new Response('wasm-bytes')), {});

    expect(result).toBe(api.fromBytes);
    const bytes = api.instantiate.mock.calls[0]?.[0];
    expect(bytes instanceof ArrayBuffer && new TextDecoder().decode(bytes)).toBe('wasm-bytes');
  });

  it('should rethrow other errors such as a CSP CompileError', async () => {
    const cspError = new Error('violates Content Security policy');
    const api = fakeApi(cspError);
    installWasmMimeFallback(api.wasm);

    await expect(api.wasm.instantiateStreaming(Promise.resolve(new Response('x')), {})).rejects.toBe(cspError);
  });
});

function fakeApi(streamingError?: Error) {
  const streamed = { instance: {}, module: {} } as WebAssembly.WebAssemblyInstantiatedSource;
  const fromBytes = { instance: {}, module: {} } as WebAssembly.WebAssemblyInstantiatedSource;
  const instantiate = vi.fn<WasmApi['instantiate']>(async () => fromBytes);
  const wasm: WasmApi = {
    instantiateStreaming: vi.fn(async () => {
      if (streamingError) throw streamingError;
      return streamed;
    }),
    instantiate,
  };
  return { wasm, instantiate, streamed, fromBytes };
}
