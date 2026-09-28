import { useEffect, useRef } from 'react';

import type { InspectionPlan } from '../../domain/types';
import type { MissionSample, TaskState } from '../../sim/playback';
import { taskStateAt } from '../../sim/playback';
import type { MissionResult, MissionTaskResult } from '../../sim/simulator';

export interface TaskListPanelProps {
  mission: MissionResult;
  sample: MissionSample;
  /** The plan as the sandbox's data has it (for its status); null if it isn't there. */
  plan: InspectionPlan | null;
}

const STATE_LABELS: Record<TaskState, string> = {
  pending: 'pending',
  'en-route': 'en route',
  inspecting: 'inspecting',
  inspected: 'inspected',
  skipped: 'skipped',
  covered: 'covered',
};

const PLAN_STATUS_TONE: Record<InspectionPlan['status'], string> = {
  Draft: 'pill-neutral',
  Ready: 'pill-live',
  Complete: 'pill-ok',
};

/** Every task of the flown plan with its state at the playback time. */
export function TaskListPanel({ mission, sample, plan }: TaskListPanelProps) {
  const listRef = useRef<HTMLOListElement>(null);
  // Keep the active task in view in long plans.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2);
    }
  }, [sample.activeTaskId]);

  // Show the status the plan had at take-off until the replay lands, so a (simulated) status
  // change made after landing flips the pill at the right moment.
  const landed = sample.done && mission.status === 'landed';
  const statusAtStart = mission.planStatusAtStart ?? plan?.status;
  const status = landed ? plan?.status : statusAtStart;
  const changed = landed && plan !== null && statusAtStart !== undefined && plan.status !== statusAtStart;

  return (
    <div className="task-list">
      <div className="task-list-header">
        <h3>Tasks · {plan?.name ?? mission.planName ?? mission.planExternalId}</h3>
        {plan && status && (
          <span className="plan-status">
            {changed && (
              <span className="muted small" title="Changed by the script in this browser only: not written to CDF">
                simulated
              </span>
            )}
            <span className={`pill ${PLAN_STATUS_TONE[status]}`} data-testid="plan-status" title="Plan status">
              {status}
            </span>
          </span>
        )}
      </div>
      {mission.tasks.length === 0 ? (
        <p className="muted small">This plan has no tasks.</p>
      ) : (
        <ol aria-label="Plan tasks" ref={listRef}>
          {mission.tasks.map((task) => {
            const coveredAt = mission.planner?.coveredTasks[task.id];
            return (
              <TaskRow
                key={task.id}
                task={task}
                state={taskStateAt(task, sample, coveredAt)}
                coveredAt={coveredAt}
                shortId={shortId(task.id, mission.planExternalId)}
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}

interface TaskRowProps {
  task: MissionTaskResult;
  state: TaskState;
  /** When the simulated gbplanner's inspection camera covered the task. */
  coveredAt: number | undefined;
  shortId: string;
}

function TaskRow({ task, state, coveredAt, shortId }: TaskRowProps) {
  const active = state === 'en-route' || state === 'inspecting';
  return (
    <li className={`task-row task-${state}`} aria-current={active ? 'true' : undefined} title={task.id}>
      <span className="mono task-id">{shortId}</span>
      <span className="task-type muted">
        {task.kind} · {task.inspectionType}
      </span>
      <span className="task-state">
        {STATE_LABELS[state]}
        {state === 'inspected' && task.visitedAt !== undefined && (
          <span className="mono muted"> at {task.visitedAt.toFixed(1)} s</span>
        )}
        {state === 'covered' && coveredAt !== undefined && (
          <span className="mono muted" title="Seen by the planner's inspection camera"> at {coveredAt.toFixed(1)} s</span>
        )}
        {state === 'skipped' && task.skipReason && <span className="task-reason"> ({task.skipReason})</span>}
      </span>
    </li>
  );
}

/** Task ids usually start with the plan id; drop it so the rows stay readable. */
function shortId(taskId: string, planExternalId: string): string {
  const prefix = `${planExternalId}-`;
  return taskId.startsWith(prefix) && taskId.length > prefix.length ? taskId.slice(prefix.length) : taskId;
}
