import { describe, expect, it } from 'vitest';

import { cleanTraceback, pyodideLoadOptions } from './session';

describe(cleanTraceback.name, () => {
  it('should drop Pyodide-internal frames and keep user frames', () => {
    const raw = [
      'Traceback (most recent call last):',
      '  File "/lib/python314.zip/_pyodide/_base.py", line 597, in eval_code_async',
      '    await CodeRunner(',
      '    ...<9 lines>...',
      '  File "main.py", line 2, in <module>',
      '    raise ValueError("boom")',
      'ValueError: boom',
      '',
    ].join('\n');

    expect(cleanTraceback(raw)).toBe(
      ['Traceback (most recent call last):', '  File "main.py", line 2, in <module>', '    raise ValueError("boom")', 'ValueError: boom'].join('\n'),
    );
  });

  it('should keep sandbox SDK frames', () => {
    const raw = '  File "/home/pyodide/.sandbox_lib/dss_sandbox/simdrone.py", line 1, in x\n    y()\nRuntimeError: no';

    expect(cleanTraceback(raw)).toBe(raw);
  });
});

describe(pyodideLoadOptions.name, () => {
  it('should load everything from the app origin, never the CDN', () => {
    const options = pyodideLoadOptions('https://app.test/pyodide/');

    expect(options).toEqual({
      indexURL: 'https://app.test/pyodide/',
      packageBaseUrl: 'https://app.test/pyodide/',
    });
  });

  it('should let Pyodide locate itself when no index URL is given', () => {
    expect(pyodideLoadOptions(undefined)).toEqual({});
  });
});
