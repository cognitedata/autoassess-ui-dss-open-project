export interface FetchScope {
  fetch: typeof fetch;
}

const STDLIB_FILE = 'python_stdlib.zip';

/**
 * Flows App Hosting refuses to host archive files, so the Python standard library (Pyodide's
 * `python_stdlib.zip`) ships inside the worker bundle instead (see sandbox.worker.ts). Pyodide
 * still fetches `<indexURL>python_stdlib.zip`; this answers that one request from the embedded
 * bytes and passes everything else through.
 */
export function installEmbeddedStdlib(scope: FetchScope, loadBytes: () => Uint8Array<ArrayBuffer>): void {
  const original = scope.fetch.bind(scope);
  scope.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url, 'http://local.invalid/').pathname.endsWith(`/${STDLIB_FILE}`)) {
      return new Response(loadBytes(), { headers: { 'Content-Type': 'application/zip' } });
    }
    return original(input, init);
  };
}

/** Bytes of a `data:…;base64,…` URL, as produced by Vite's `?inline` asset imports. */
export function decodeDataUrl(dataUrl: string): Uint8Array<ArrayBuffer> {
  const match = /^data:[^,]*;base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Expected a base64 data URL for the embedded Python standard library');
  return Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
}
