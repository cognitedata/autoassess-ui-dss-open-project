import { python } from '@codemirror/lang-python';
import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { basicSetup, EditorView } from 'codemirror';
import { useEffect, useRef } from 'react';

export interface CodeEditorProps {
  value: string;
  onChange(value: string): void;
  /** Ctrl/Cmd+Enter. */
  onRun(): void;
}

/** CodeMirror 6 Python editor. Controlled: external `value` changes replace the document. */
export function CodeEditor({ value, onChange, onRun }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      doc: value,
      parent: host,
      extensions: [
        basicSetup,
        python(),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                onRunRef.current();
                return true;
              },
            },
          ]),
        ),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'Python code' }),
      ],
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The document is seeded once; later values flow in through the effect below.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="code-editor" data-testid="code-editor" />;
}
