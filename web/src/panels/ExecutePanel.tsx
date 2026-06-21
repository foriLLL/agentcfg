import type { ReactNode } from 'react';
import type { AgentName, ApplyAgentResult, ApplyPlanSummary, RuntimeStateSummary } from '../api';
import { AgentConfigIcon } from '../AgentConfigIcon';
import { BUTTONS, GATES, previewReadinessBadge } from '../strings';
import { StatusBadge } from '../widgets';
import { ApplyResults, PlanResults } from './PlanApplyResults';

type TargetMode = AgentName | 'all' | '';
type ExecuteTargetOption = { readonly value: Exclude<TargetMode, ''>; readonly title: string; readonly copy: string };

const TARGET_OPTIONS: readonly ExecuteTargetOption[] = [
  { value: 'codex', title: 'Codex', copy: '检查 ~/.codex 设置与生成的 env 文件。' },
  { value: 'opencode', title: 'OpenCode', copy: '检查一个 OpenCode JSON 或 JSONC 配置。' },
  { value: 'openclaw', title: 'OpenClaw', copy: '检查一个 OpenClaw JSON 或 JSON5 配置。' },
  { value: 'claude', title: 'Claude Code', copy: '检查 Claude Code settings.json 配置。' },
  { value: 'ohmyopenagent', title: 'OhMyOpenAgent', copy: '检查 OhMyOpenAgent 模型路由配置。' },
  { value: 'all', title: '全部代理', copy: '同时处理 Codex、OpenCode、OpenClaw、Claude Code 与 OhMyOpenAgent。' },
];

export type ExecutePanelProps = {
  readonly runtimeState: RuntimeStateSummary | null;
  readonly loadErrorNode: ReactNode;

  readonly targetMode: TargetMode;
  readonly onTargetModeChange: (target: Exclude<TargetMode, ''>) => void;

  readonly configPath: string;
  readonly onConfigPathChange: (value: string) => void;
  readonly requestStatePath: string | undefined;

  readonly onPlan: () => void | Promise<void>;
  readonly canReview: boolean;
  readonly isPlanning: boolean;

  readonly confirmationText: string;
  readonly onConfirmationTextChange: (value: string) => void;
  readonly isPlanCurrent: boolean;
  readonly canApply: boolean;
  readonly isApplying: boolean;
  readonly onApply: () => void | Promise<void>;

  // Result data (rendered via shared PlanApplyResults).
  readonly planResponse: { readonly plans: ApplyPlanSummary[]; readonly results: ApplyAgentResult[] } | null;
  readonly applyResults: ApplyAgentResult[] | null;
};

/**
 * "审阅与应用" tab content extracted verbatim from App.tsx.
 *
 * Stateless. App still owns targetMode / planResponse / planKey /
 * applyResults / confirmationText and the handlers (handlePlan,
 * handleApply). The panel only renders the existing #execute-panel /
 * #review-panel grid.
 */
export function ExecutePanel(props: ExecutePanelProps) {
  const dryRunBadge = previewReadinessBadge({ hasPlan: props.isPlanCurrent, hasTarget: props.targetMode !== '' });

  return (
    <section className="dashboard-grid" id="execute-panel" role="tabpanel" aria-labelledby="execute-tab">
      {props.loadErrorNode}
      <article className="card diff-card execute-card" id="review-panel">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">审阅与应用</p>
            <h2>Dry-run、再输入确认应用</h2>
          </div>
          <StatusBadge tone={dryRunBadge.tone}>{dryRunBadge.label}</StatusBadge>
        </div>

        <div className="review-layout">
          <section className="review-controls" aria-label="审阅控制">
            <fieldset className="target-grid">
              <legend>请选择一个目标</legend>
              {TARGET_OPTIONS.map((target) => (
                <label className="target-option" key={target.value}>
                  <input
                    type="radio"
                    name="target-mode"
                    value={target.value}
                    checked={props.targetMode === target.value}
                    onChange={() => props.onTargetModeChange(target.value)}
                  />
                  <span>
                    <span className="target-option__title">
                      {target.value !== 'all' && <AgentConfigIcon agent={target.value as AgentName} />}
                      <strong>{target.title}</strong>
                    </span>
                    <small>{target.copy}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="path-form">
              <label htmlFor="config-path">
                配置路径覆盖
                <input
                  id="config-path"
                  value={props.configPath}
                  onChange={(event) => props.onConfigPathChange(event.target.value)}
                  placeholder="单个配置文件、配置目录，或留空使用默认值"
                  autoComplete="off"
                />
              </label>
              <div className="path-note">
                <span>实际状态路径</span>
                <strong>{props.requestStatePath ?? '默认本地状态'}</strong>
              </div>
            </div>

            <div className="review-actions" aria-label="dry-run 与应用操作">
              <button className="secondary-action" type="button" onClick={props.onPlan} disabled={!props.canReview}>
                {props.isPlanning ? BUTTONS.dryRunRunning : BUTTONS.dryRun}
              </button>
            </div>

            <div className="apply-lock" aria-label="应用安全门禁">
              <div>
                <p className="eyebrow">{GATES.applyConfirmEyebrow}</p>
                <h3>{GATES.applyConfirmTitle}</h3>
                <p>只有所选目标与路径匹配最新计划后，应用才会解锁。</p>
              </div>
              <label htmlFor="apply-confirmation">
                确认文本
                <input
                  id="apply-confirmation"
                  value={props.confirmationText}
                  onChange={(event) => props.onConfirmationTextChange(event.target.value)}
                  placeholder={GATES.applyConfirmPlaceholder}
                  autoComplete="off"
                  disabled={!props.isPlanCurrent || props.isApplying}
                />
              </label>
              <button className="primary-action" type="button" onClick={props.onApply} disabled={!props.canApply}>
                {props.isApplying ? BUTTONS.applyRunning : BUTTONS.apply}
              </button>
            </div>
          </section>

          <section className="review-results" aria-label="dry-run 与应用结果">
            <PlanResults
              plans={props.planResponse?.plans ?? null}
              results={props.planResponse?.results ?? null}
              stale={props.planResponse !== null && !props.isPlanCurrent}
            />
            <ApplyResults results={props.applyResults} />
          </section>
        </div>
      </article>
    </section>
  );
}
