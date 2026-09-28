import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@cognite/aura/components';
import { useViewerSettingsStore } from './viewerSettingsStore';
import type { ControlsMode } from './viewerControlsModeStore';
import { useViewerControlsModeStore } from './viewerControlsModeStore';

interface ViewerControlsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResetRoll?: () => void;
}

const CONTROLS_FREE: { action: string; control: string }[] = [
  { action: 'Move forward / back',  control: 'W / S  or  ↑ / ↓' },
  { action: 'Strafe left / right',  control: 'A / D  or  ← / →' },
  { action: 'Float up / down',      control: 'R / F' },
  { action: 'Yaw left / right',     control: 'Q / E' },
  { action: 'Pitch up / down',      control: 'T / G' },
  { action: 'Roll left / right',    control: 'Z / X' },
  { action: 'Look around',          control: 'Left-drag' },
  { action: 'Pan',                  control: 'Right-drag  or  Middle-drag' },
  { action: 'Dolly',                control: 'Mouse wheel' },
];

const CONTROLS_GROUND_PLANE: { action: string; control: string }[] = [
  { action: 'Move forward / back',  control: 'W / S  or  ↑ / ↓' },
  { action: 'Strafe left / right',  control: 'A / D  or  ← / →' },
  { action: 'Rise / lower',         control: 'R / F' },
  { action: 'Turn left / right',    control: 'Q / E' },
  { action: 'Roll left / right',    control: 'Z / X' },
  { action: 'Look around',          control: 'Left-drag' },
  { action: 'Pan along ground',     control: 'Right-drag  or  Middle-drag' },
  { action: 'Dolly',                control: 'Mouse wheel' },
];

interface SpeedSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}

function SpeedSlider({ label, value, min, max, step, unit, onChange }: SpeedSliderProps) {
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id} className="font-medium">{label}</label>
        <span className="tabular-nums text-muted-foreground">{value} {unit}</span>
      </div>
      <input
        id={id}
        type="range"
        role="slider"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

interface ModeButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function ModeButton({ label, active, onClick }: ModeButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

export function ViewerControlsModal({ open, onOpenChange, onResetRoll }: ViewerControlsModalProps) {
  const {
    moveSpeed, setMoveSpeed,
    keyRotateSpeed, setKeyRotateSpeed,
    mouseRotateSpeed, setMouseRotateSpeed,
    setMousePanSpeed,
    setMouseScrollSpeed,
  } = useViewerSettingsStore();

  const { mode, setMode } = useViewerControlsModeStore();

  const handleMouseSensitivity = (v: number) => {
    // Pan and scroll scale proportionally with rotate sensitivity
    setMouseRotateSpeed(v);
    setMousePanSpeed(parseFloat((v * (0.005 / 0.003)).toFixed(4)));
    setMouseScrollSpeed(parseFloat((v * (0.01 / 0.003)).toFixed(4)));
  };

  const controls = mode === 'free' ? CONTROLS_FREE : CONTROLS_GROUND_PLANE;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Camera controls</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* ── Control mode toggle ─────────────────────────── */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Navigation mode
            </h3>
            <div
              role="toolbar"
              aria-label="Navigation mode"
              className="flex gap-1 rounded-md border border-border p-0.5"
            >
              <ModeButton
                label="Free flight"
                active={mode === 'free'}
                onClick={() => setMode('free' as ControlsMode)}
              />
              <ModeButton
                label="Ground plane"
                active={mode === 'ground-plane'}
                onClick={() => setMode('ground-plane' as ControlsMode)}
              />
            </div>
          </section>

          {/* ── Controls reference ─────────────────────────── */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Keyboard &amp; mouse
            </h3>
            <table className="w-full text-sm">
              <tbody>
                {controls.map(({ action, control }) => (
                  <tr key={action} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-4 text-muted-foreground">{action}</td>
                    <td className="py-1.5 font-mono text-xs">{control}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* ── Ground-plane actions ───────────────────────── */}
          {mode === 'ground-plane' && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Actions
              </h3>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Snap horizon to level</span>
                <Button variant="outline" size="sm" onClick={onResetRoll}>
                  Reset roll
                </Button>
              </div>
            </section>
          )}

          {/* ── Speed settings ─────────────────────────────── */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Speed
            </h3>
            <div className="space-y-4">
              <SpeedSlider
                label="Movement speed"
                value={moveSpeed}
                min={1} max={50} step={1}
                unit="m/s"
                onChange={setMoveSpeed}
              />
              <SpeedSlider
                label="Rotation speed"
                value={keyRotateSpeed}
                min={0.3} max={5} step={0.1}
                unit="rad/s"
                onChange={setKeyRotateSpeed}
              />
              <SpeedSlider
                label="Mouse sensitivity"
                value={mouseRotateSpeed}
                min={0.001} max={0.010} step={0.001}
                unit="rad/px"
                onChange={handleMouseSensitivity}
              />
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
