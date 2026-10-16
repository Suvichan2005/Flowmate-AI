import type { KernelEntity } from '../../services/kernel/types';
import { useStore } from '../../store';
import { setDemoModeSyncBlock } from '../../services/syncManager';

export const generateSyntheticDemoEntities = (): Record<string, KernelEntity> => {
  const now = new Date().toISOString();
  return {
    'synthetic-demo-task': {
      id: 'synthetic-demo-task',
      schema_id: 'system/task',
      version: 1,
      title: 'Synthetic demo task',
      attributes: { priority: 2, estimated_minutes: 30 },
      lifecycle: { status: 'todo', created_at: now, updated_at: now, deleted_at: null },
      provenance: { source_type: 'user', observed_at: now, confidence: 1, is_inferred: false, user_confirmed: true },
    },
  };
};

export const loadSyntheticDemoData = () => useStore.getState().enterDemoMode(generateSyntheticDemoEntities());
export const exitSyntheticDemoData = async () => {
  setDemoModeSyncBlock(false);
  await useStore.getState().exitDemoMode();
};
export const resetSyntheticDemoData = () => useStore.getState().resetDemoWorkspace(generateSyntheticDemoEntities());