import type { ReactNode } from "react";
import { ExecutePanel, type ExecutePanelProps } from "./ExecutePanel";
import type { LocalConfigPanelProps } from "./LocalConfigPanel";

export type SyncTargetsPanelProps = {
  readonly heading?: ReactNode;
  readonly execute: ExecutePanelProps;
  readonly localConfig: LocalConfigPanelProps;
  readonly rulesPanelNode: ReactNode;
  readonly skillsPanelNode: ReactNode;
};

/**
 * "同步到本地" tab content.
 *
 * Composes the dry-run / apply flow with three advanced surfaces that
 * the previous IA exposed as separate tabs:
 *
 *   1. ExecutePanel (primary)      pick a target, run dry-run, apply
 *   2. Native file edit (collapsed)  raw editor for the selected agent
 *   3. Rule files (collapsed)       Codex/Claude/Gemini *.md sync
 *   4. Agent Skills (collapsed)     ~/.agents/skills mirror
 *
 * Each advanced <details> is collapsed by default. The user reaches
 * every historic tab in one place, but the primary action remains the
 * agent-config dry-run/apply sitting at the top of the tab. PR4-c1
 * already removed the four corresponding nav entries; this commit
 * gives the leftover panels a single home.
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
