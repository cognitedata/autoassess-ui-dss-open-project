import { describe, it, expect, beforeEach } from 'vitest';
import { useActivePlanStore } from './activePlanStore';
import { createMockInspectionPlan } from '../../__mocks__/inspectionPlans';
import { createMockElementTask, createMockRegionTask } from '../../__mocks__/inspectionTasks';

describe('activePlanStore', () => {
  beforeEach(() => {
    useActivePlanStore.setState({ activePlan: null, activePlanTasks: [] });
  });

  describe('setActivePlan', () => {
    it('should set the active plan', () => {
      const plan = createMockInspectionPlan();
      useActivePlanStore.getState().setActivePlan(plan);
      expect(useActivePlanStore.getState().activePlan).toEqual(plan);
    });

    it('should clear tasks when a new plan is selected', () => {
      const task = createMockElementTask();
      useActivePlanStore.setState({ activePlanTasks: [task] });

      useActivePlanStore.getState().setActivePlan(createMockInspectionPlan());

      expect(useActivePlanStore.getState().activePlanTasks).toEqual([]);
    });
  });

  describe('clearActivePlan', () => {
    it('should set activePlan to null', () => {
      useActivePlanStore.getState().setActivePlan(createMockInspectionPlan());
      useActivePlanStore.getState().clearActivePlan();
      expect(useActivePlanStore.getState().activePlan).toBeNull();
    });

    it('should clear tasks', () => {
      useActivePlanStore.setState({ activePlanTasks: [createMockElementTask()] });
      useActivePlanStore.getState().clearActivePlan();
      expect(useActivePlanStore.getState().activePlanTasks).toEqual([]);
    });
  });

  describe('setActivePlanTasks', () => {
    it('should replace the tasks list', () => {
      const tasks = [createMockElementTask(), createMockRegionTask()];
      useActivePlanStore.getState().setActivePlanTasks(tasks);
      expect(useActivePlanStore.getState().activePlanTasks).toEqual(tasks);
    });
  });

  describe('updateActivePlan', () => {
    it('should apply the updater when a plan is active', () => {
      useActivePlanStore.getState().setActivePlan(createMockInspectionPlan({ status: 'Draft' }));

      useActivePlanStore.getState().updateActivePlan((p) => ({ ...p, status: 'Ready' }));

      expect(useActivePlanStore.getState().activePlan?.status).toBe('Ready');
    });

    it('should no-op when no plan is active', () => {
      // Should not throw
      useActivePlanStore.getState().updateActivePlan((p) => ({ ...p, status: 'Ready' }));
      expect(useActivePlanStore.getState().activePlan).toBeNull();
    });
  });
});
