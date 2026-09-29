import { useEffect, useRef } from 'react';

import type { ConsoleChunk } from './consoleBuffer';

export interface ConsolePanelProps {
  chunks: ConsoleChunk[];
  onClear(): void;
}

export function ConsolePanel({ chunks, onClear }: ConsolePanelProps) {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chunks]);

  return (
    <section className="panel console-panel" aria-label="Console">
      <div className="panel-header">
        <h2>Console</h2>
        <button type="button" className="btn btn-ghost btn-small" onClick={onClear} disabled={chunks.length === 0}>
          Clear
        </button>
      </div>
      <pre ref={ref} className="console-output" role="log" aria-live="polite" data-testid="console-output">
        {chunks.length === 0 ? (
          <span className="console-placeholder">Output of your script appears here. Run with Ctrl/⌘+Enter.</span>
        ) : (
          chunks.map((c) => (
            <span key={c.id} className={`console-${c.stream}`}>
              {c.text}
            </span>
          ))
        )}
      </pre>
    </section>
  );
}
