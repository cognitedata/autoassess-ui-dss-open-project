type StreamingFn = typeof WebAssembly.instantiateStreaming;
type InstantiateFn = (bytes: BufferSource, imports?: WebAssembly.Imports) => Promise<WebAssembly.WebAssemblyInstantiatedSource>;

export interface WasmApi {
  instantiateStreaming: StreamingFn;
  instantiate: InstantiateFn;
}

/**
 * Pyodide compiles its .wasm with WebAssembly.instantiateStreaming, which throws a TypeError if
 * the server doesn't send `Content-Type: application/wasm` — and Pyodide then hangs instead of
 * failing. We don't control the Flows hosting headers, so fall back to compiling from bytes.
 */
export function installWasmMimeFallback(wasm: WasmApi): void {
  const streaming = wasm.instantiateStreaming.bind(wasm);
  const instantiate = wasm.instantiate.bind(wasm);
  wasm.instantiateStreaming = async (source, imports) => {
    const response = await source;
    const copy = response.clone();
    try {
      return await streaming(response, imports);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err; // CompileError (e.g. CSP) must surface as-is
      return instantiate(await copy.arrayBuffer(), imports);
    }
  };
}
