// Web Worker entry: runs Pyodide off the main thread. Must be a *module* worker (Pyodide 314+
// refuses classic workers). All logic lives in workerHandler.ts.
import { loadPyodide } from 'pyodide';
// Vite inlines the archive as a data URL; App Hosting won't host .zip files (see embeddedStdlib.ts).
import stdlibDataUrl from 'pyodide/python_stdlib.zip?inline';

import type { FromWorker, ToWorker } from './protocol';
import { PYTHON_FILES } from './pythonFiles';
import { decodeDataUrl, installEmbeddedStdlib } from './embeddedStdlib';
import { installWasmMimeFallback } from './wasmFallback';
import { createWorkerHandler } from './workerHandler';

// `self` is typed as Window by the DOM lib; postMessage(message) / onmessage have the same
// shape on DedicatedWorkerGlobalScope, so no webworker lib (which clashes with DOM) is needed.
installWasmMimeFallback(WebAssembly);
installEmbeddedStdlib(self, () => decodeDataUrl(stdlibDataUrl));

const handle = createWorkerHandler({
  loadPyodide,
  files: PYTHON_FILES,
  post: (message: FromWorker) => self.postMessage(message),
});

self.onmessage = (event: MessageEvent<ToWorker>) => {
  void handle(event.data);
};
