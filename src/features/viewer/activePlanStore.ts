import { create } from 'zustand';
import type { InspectionPlan } from './InspectionPlanService';
import type { InspectionTask } from './InspectionTaskService';

export interface ActivePlanState {
  activePlan: InspectionPlan | null;
  activePlanTasks: InspectionTask[];
  setActivePlan(plan: InspectionPlan): void;
  clearActivePlan(): void;
  /**
   * Synced from React Query by the ViewModel whenever the task list changes.
   * Allows 3D layers to subscribe imperatively without React render cycles.
   */
  setActivePlanTasks(tasks: InspectionTask[]): void;
  /** Update fields on the active plan without a round-trip (e.g. after status change). */
  updateActivePlan(updater: (plan: InspectionPlan) => InspectionPlan): void;
}

export const useActivePlanStore = create<ActivePlanState>((set, get) => ({
  activePlan: null,
  activePlanTasks: [],

  setActivePlan(plan) {
    set({ activePlan: plan, activePlanTasks: [] });
  },

  clearActivePlan() {
    set({ activePlan: null, activePlanTasks: [] });
  },

  setActivePlanTasks(tasks) {
    set({ activePlanTasks: tasks });
  },

  updateActivePlan(updater) {
    const { activePlan } = get();
    if (!activePlan) return;
    set({ activePlan: updater(activePlan) });
  },
}));
