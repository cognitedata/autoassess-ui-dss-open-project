import type { SandboxViewModel } from './useSandboxViewModel';
import { useSandboxViewModel } from './useSandboxViewModel';
import { CodeEditor } from '../editor/CodeEditor';
import { SimulatorPanel } from '../simulator/SimulatorPanel';
import { ConsolePanel } from './ConsolePanel';

export interface SandboxPageProps {
  /** Shown above the workspace, e.g. when Fusion could not be reached. */
  notice?: string;
}

export function SandboxPage({ notice }: SandboxPageProps) {
  const vm = useSandboxViewModel();
  const elements = vm.data.state === 'ready' ? vm.data.snapshot.elements : [];
  const plans = vm.data.state === 'ready' ? vm.data.snapshot.plans : [];

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>AutoAssess Drone Sandbox</h1>
          <p className="muted small">
            Python in your browser with the <code>uidss</code> SDK: pick up inspection plans, check them, send off a
            simulated drone.
          </p>
        </div>
        <div className="topbar-status">
          <DataStatus vm={vm} />
          <PythonStatusPill vm={vm} />
        </div>
      </header>

      {notice && (
        <div className="alert alert-warning" role="status">
          {notice}
        </div>
      )}
      {vm.data.state === 'error' && (
        <div className="alert alert-error" role="alert">
          Could not load plans: {vm.data.message}{' '}
          <button type="button" className="btn btn-small" onClick={vm.reloadData}>
            Retry
          </button>
        </div>
      )}
      {vm.pythonError && (
        <div className="alert alert-error" role="alert">
          {vm.pythonError}{' '}
          <button type="button" className="btn btn-small" onClick={vm.reset}>
            Try again
          </button>
        </div>
      )}

      <main className="workspace">
        <div className="column column-code">
          <div className="toolbar">
            <label className="example-select">
              <span className="sr-only">Starter example</span>
              <select value={vm.exampleId} onChange={(e) => vm.selectExample(e.target.value)} aria-label="Starter example">
                {vm.examples.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.title}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={() => void vm.run()} disabled={!vm.canRun}>
              ▶ Run
            </button>
            <button type="button" className="btn" onClick={vm.stop} disabled={!vm.isRunning}>
              ■ Stop
            </button>
            <button type="button" className="btn btn-ghost" onClick={vm.reset} disabled={vm.pythonStatus === 'waiting-for-data'}>
              Reset
            </button>
          </div>
          <section className="panel editor-panel" aria-label="Editor">
            <CodeEditor value={vm.code} onChange={vm.setCode} onRun={() => void vm.run()} />
          </section>
          <ConsolePanel chunks={vm.consoleChunks} onClear={vm.clearConsole} />
        </div>
        <div className="column column-sim">
          <SimulatorPanel mission={vm.mission} missionId={vm.missionId} elements={elements} plans={plans} />
        </div>
      </main>
    </div>
  );
}

function DataStatus({ vm }: { vm: SandboxViewModel }) {
  return (
    <div className="data-status">
      {vm.sources.length > 1 ? (
        <select
          aria-label="Data source"
          value={vm.sourceIndex}
          onChange={(e) => vm.selectSource(Number(e.target.value))}
          disabled={vm.isRunning}
        >
          {vm.sources.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      ) : (
        <span className={`pill ${vm.sources[0]?.mode === 'live' ? 'pill-live' : 'pill-demo'}`}>
          {vm.sources[0]?.label}
        </span>
      )}
      <span className="muted small" data-testid="data-summary">
        {vm.data.state === 'loading' && 'Loading plans…'}
        {vm.data.state === 'ready' &&
          `${vm.data.snapshot.plans.length} plans · ${vm.data.snapshot.areas.length} areas`}
        {vm.data.state === 'error' && 'Data unavailable'}
      </span>
      {vm.data.state !== 'loading' && (
        <button type="button" className="btn btn-ghost btn-small" onClick={vm.reloadData} disabled={vm.isRunning}>
          Reload
        </button>
      )}
    </div>
  );
}

const PYTHON_LABELS: Record<SandboxViewModel['pythonStatus'], string> = {
  'waiting-for-data': 'Python: waiting for data',
  booting: 'Python: starting…',
  ready: 'Python: ready',
  running: 'Python: running…',
  error: 'Python: failed',
};

function PythonStatusPill({ vm }: { vm: SandboxViewModel }) {
  const tone =
    vm.pythonStatus === 'ready' ? 'pill-ok' : vm.pythonStatus === 'error' ? 'pill-error' : 'pill-busy';
  return (
    <span className={`pill ${tone}`} data-testid="python-status">
      {PYTHON_LABELS[vm.pythonStatus]}
    </span>
  );
}
