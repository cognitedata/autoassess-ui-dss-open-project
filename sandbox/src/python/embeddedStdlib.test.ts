import { describe, expect, it, vi } from 'vitest';

import type { FetchScope } from './embeddedStdlib';
import { decodeDataUrl, installEmbeddedStdlib } from './embeddedStdlib';

describe(installEmbeddedStdlib.name, () => {
  it('should answer Pyodide\'s python_stdlib.zip request from the embedded bytes', async () => {
    const scope = fakeScope();
    installEmbeddedStdlib(scope, () => new Uint8Array([1, 2, 3]));

    const response = await scope.fetch('https://app.test/pyodide/python_stdlib.zip');

    expect(response.ok).toBe(true);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(scope.original).not.toHaveBeenCalled();
  });

  it('should pass every other request through unchanged', async () => {
    const scope = fakeScope();
    installEmbeddedStdlib(scope, () => new Uint8Array());

    await scope.fetch('https://app.test/pyodide/pyodide.asm.wasm', { method: 'GET' });

    expect(scope.original).toHaveBeenCalledWith('https://app.test/pyodide/pyodide.asm.wasm', { method: 'GET' });
  });

  it('should decode the embedded archive only when it is requested', async () => {
    const scope = fakeScope();
    const load = vi.fn(() => new Uint8Array([9]));
    installEmbeddedStdlib(scope, load);

    await scope.fetch('https://app.test/index.html');
    expect(load).not.toHaveBeenCalled();

    await scope.fetch(new URL('https://app.test/pyodide/python_stdlib.zip'));
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe(decodeDataUrl.name, () => {
  it('should return the bytes of a base64 data URL', () => {
    expect(decodeDataUrl('data:application/zip;base64,AQID')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('should reject anything that is not a base64 data URL', () => {
    expect(() => decodeDataUrl('/assets/python_stdlib.zip')).toThrow(/base64 data URL/);
  });
});

// ---- helpers ----

function fakeScope(): FetchScope & { original: ReturnType<typeof vi.fn> } {
  const original = vi.fn(async () => new Response('network'));
  return { fetch: original, original };
}
