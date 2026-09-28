import { beforeEach, describe, expect, it } from 'vitest';
import { usePcdVisibilityStore } from './pcdVisibilityStore';

describe(usePcdVisibilityStore.name, () => {
  beforeEach(() => {
    usePcdVisibilityStore.setState({ visibility: {} });
  });

  it('should default to hidden for any unknown key', () => {
    expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-42')).toBe(false);
    expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-99')).toBe(false);
  });

  it('should return true after setPcdVisible(key, true)', () => {
    usePcdVisibilityStore.getState().setPcdVisible('pcd-42', true);
    expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-42')).toBe(true);
  });

  it('should return false after setPcdVisible(key, false)', () => {
    usePcdVisibilityStore.getState().setPcdVisible('pcd-42', true);
    usePcdVisibilityStore.getState().setPcdVisible('pcd-42', false);
    expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-42')).toBe(false);
  });

  it('should not affect other keys when one is explicitly set', () => {
    usePcdVisibilityStore.getState().setPcdVisible('pcd-42', true);
    expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-99')).toBe(false);
  });

  it('should allow toggling back to visible after being hidden', () => {
    usePcdVisibilityStore.getState().setPcdVisible('pcd-42', false);
    usePcdVisibilityStore.getState().setPcdVisible('pcd-42', true);
    expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-42')).toBe(true);
  });

  describe('initPcdKeys', () => {
    it('sets unknown keys to false', () => {
      usePcdVisibilityStore.getState().initPcdKeys(['pcd-1', 'pcd-2']);
      expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-1')).toBe(false);
      expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-2')).toBe(false);
    });

    it('does not override a key that was explicitly shown', () => {
      usePcdVisibilityStore.getState().setPcdVisible('pcd-1', true);
      usePcdVisibilityStore.getState().initPcdKeys(['pcd-1']);
      expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-1')).toBe(true);
    });

    it('is idempotent when called with the same keys twice', () => {
      usePcdVisibilityStore.getState().initPcdKeys(['pcd-1']);
      usePcdVisibilityStore.getState().initPcdKeys(['pcd-1']);
      expect(usePcdVisibilityStore.getState().isPcdVisible('pcd-1')).toBe(false);
    });
  });
});
