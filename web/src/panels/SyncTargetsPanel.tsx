import type { ReactNode } from "react";
import { ExecutePanel, type ExecutePanelProps } from "./ExecutePanel";
import type { LocalConfigPanelProps } from "./LocalConfigPanel";

export type SyncTargetsPanelProps = {
  readonly heading?: ReactNode;
  readonly execute: ExecutePanelProps;
  readonly localConfig: LocalConfigPanelProps;
};

/**
 * "同步到本地" tab content.
 *
 * This tab now owns only the agent-config dry-run / apply flow.
 * Native file editing is moving to Settings, while rule files and
 * Agent Skills live in the dedicated Rules & Skills section.
 *
 * Future PR (one-APPLY orchestration): SyncTargetsPanel will become
 * the orchestration layer that fans dry-run + apply across agents,
 * rule files and skills based on a single selection set. That requires
 * a coordinated dry-run API change and is intentionally not bundled
 * here so this commit can ship as pure UI reshuffling.
 */
export function SyncTargetsPanel({ execute, heading }: SyncTargetsPanelProps) {
  return (
    <section className="sync-targets-panel" aria-label="同步到本地">
      {heading}
      <ExecutePanel {...execute} />
    </section>
  );
}
