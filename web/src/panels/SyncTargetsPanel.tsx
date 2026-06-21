import type { ReactNode } from 'react';
import { ExecutePanel, type ExecutePanelProps } from './ExecutePanel';

export type SyncTargetsPanelProps = {
  readonly heading?: ReactNode;
  readonly execute: ExecutePanelProps;
};

/**
 * "同步" tab content.
 *
 * This tab now owns only the sync review/apply flow. Raw config editing
 * lives in Settings, while rule files and Agent Skills live in the
 * dedicated Rules & Skills section.
 */
export function SyncTargetsPanel({ execute, heading }: SyncTargetsPanelProps) {
  return (
    <section className="sync-targets-panel" aria-label="同步">
      {heading}
      <ExecutePanel {...execute} />
    </section>
  );
}
