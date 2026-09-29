export type ConsoleStream = 'stdout' | 'stderr' | 'system' | 'error';

export interface ConsoleChunk {
  id: number;
  stream: ConsoleStream;
  text: string;
}

/** Console keeps at most this many characters (a print loop must not eat the tab's memory). */
export const CONSOLE_LIMIT_CHARS = 200_000;
export const TRUNCATION_NOTICE = '… earlier output truncated …\n';

let nextId = 1;

/** Appends text, merging with the previous chunk of the same stream, trimming the oldest output. */
export function appendConsole(
  chunks: readonly ConsoleChunk[],
  stream: ConsoleStream,
  text: string,
  limit = CONSOLE_LIMIT_CHARS,
): ConsoleChunk[] {
  if (!text) return [...chunks];
  const out = [...chunks];
  const last = out.at(-1);
  if (last && last.stream === stream) out[out.length - 1] = { ...last, text: last.text + text };
  else out.push({ id: nextId++, stream, text });

  let total = out.reduce((n, c) => n + c.text.length, 0);
  if (total <= limit) return out;
  if (out[0]?.text === TRUNCATION_NOTICE) total -= out.shift()?.text.length ?? 0;
  while (total > limit && out.length > 0) {
    const first = out[0];
    const excess = total - limit;
    if (first.text.length <= excess) {
      out.shift();
      total -= first.text.length;
    } else {
      out[0] = { ...first, text: first.text.slice(excess) };
      total -= excess;
    }
  }
  return [{ id: nextId++, stream: 'system', text: TRUNCATION_NOTICE }, ...out];
}
