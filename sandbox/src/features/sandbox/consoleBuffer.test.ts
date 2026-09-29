import { describe, expect, it } from 'vitest';

import { appendConsole, TRUNCATION_NOTICE } from './consoleBuffer';

describe(appendConsole.name, () => {
  it('should merge consecutive text of the same stream', () => {
    const chunks = appendConsole(appendConsole([], 'stdout', 'a\n'), 'stdout', 'b\n');

    expect(chunks.map((c) => [c.stream, c.text])).toEqual([['stdout', 'a\nb\n']]);
  });

  it('should start a new chunk when the stream changes', () => {
    const chunks = appendConsole(appendConsole([], 'stdout', 'a\n'), 'stderr', 'oops\n');

    expect(chunks.map((c) => c.stream)).toEqual(['stdout', 'stderr']);
  });

  it('should ignore empty text', () => {
    expect(appendConsole([], 'stdout', '')).toEqual([]);
  });

  it('should drop the oldest output beyond the limit and say so once', () => {
    let chunks = appendConsole([], 'stdout', '0123456789', 12);
    chunks = appendConsole(chunks, 'stderr', 'abcdef', 12);
    chunks = appendConsole(chunks, 'stdout', 'XYZ', 12);

    expect(chunks[0].text).toBe(TRUNCATION_NOTICE);
    expect(chunks.filter((c) => c.text === TRUNCATION_NOTICE)).toHaveLength(1);
    expect(chunks.slice(1).map((c) => c.text).join('')).toBe('789abcdefXYZ');
  });
});
