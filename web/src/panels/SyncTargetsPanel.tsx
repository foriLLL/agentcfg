import type { ReactNode } from 'react';
import { ExecutePanel, type ExecutePanelProps } from './ExecutePanel';
import { LocalConfigPanel, type LocalConfigPanelProps } from './LocalConfigPanel';

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
 * Each <details> is collapsed by default. The user reaches every
 * historic tab in one place, but the primary action remains the
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
export function SyncTargetsPanel({
  execute,
  heading,
  localConfig,
  rulesPanelNode,
  skillsPanelNode,
}: SyncTargetsPanelProps) {
  return (
    <section className="sync-targets-panel" aria-label="同步到本地">
      {heading}
      <ExecutePanel {...execute} />

      <details className="sync-targets-panel__advanced">
        <summary>
          <span>原生配置原文编辑</span>
          <small>直接编辑当前所选 Agent 的原生配置文件；保存后会让上方预览失效。</small>
        </summary>
        <LocalConfigPanel {...localConfig} />
      </details>

      <details className="sync-targets-panel__advanced">
        <summary>
          <span>规则文件</span>
          <small>同步 Codex / Claude / Gemini 用户级规则文件。</small>
        </summary>
        {rulesPanelNode}
      </details>

      <details className="sync-targets-panel__advanced">
        <summary>
          <span>Agent Skills 目录</span>
          <small>镜像 ~/.agents/skills 与远端 manifest。</small>
        </summary>
        {skillsPanelNode}
      </details>
    </section>
  );
}
