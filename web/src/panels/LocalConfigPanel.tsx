import type { ReactNode } from 'react';
import type { AgentName, ConfigAvailabilityEntry, ConfigFileRuntimeResponse, RuntimeStateSummary } from '../api';
import { AgentConfigIcon } from '../AgentConfigIcon';
import { LocalConfigAgentSummary } from '../LocalConfigAgentSummary';
import { BUTTONS, GATES, configDraftBadge } from '../strings';
import { StatusBadge } from '../widgets';
import { localReviewActionCopyForAgent } from '../view-model';

const CONFIG_TARGET_OPTIONS: Array<{ value: AgentName; title: string; copy: string }> = [
  { value: 'codex', title: 'Codex', copy: 'TOML 配置原文' },
  { value: 'opencode', title: 'OpenCode', copy: 'JSON / JSONC 配置原文' },
  { value: 'openclaw', title: 'OpenClaw', copy: 'JSON / JSON5 配置原文' },
  { value: 'claude', title: 'Claude Code', copy: 'settings.json 配置原文' },
  { value: 'ohmyopenagent', title: 'OhMyOpenAgent', copy: '模型路由 JSON 原文' },
];

export type LocalConfigPanelProps = {
  readonly runtimeState: RuntimeStateSummary | null;
  readonly loadErrorNode: ReactNode;

  // Tab state
  readonly targetMode: AgentName | 'all' | '';
  readonly onTargetModeChange: (target: AgentName) => void;
  readonly configAgent: AgentName | null;

  // Availability + summary
  readonly configAvailabilityByAgent: Map<AgentName, ConfigAvailabilityEntry>;
  readonly isLoadingConfigAvailability: boolean;
  readonly selectedConfigAvailability: ConfigAvailabilityEntry | undefined;
  readonly configFile: ConfigFileRuntimeResponse | null;
  readonly configPathModeLabel: string;

  // File editor
  readonly configPath: string;
  readonly onConfigPathChange: (value: string) => void;
  readonly configDraft: string;
  readonly onConfigDraftChange: (value: string) => void;
  readonly configStatus: string;

  readonly onLoadConfigFile: () => void | Promise<void>;
  readonly onSaveConfigFile: () => void | Promise<void>;
  readonly canLoadConfig: boolean;
  readonly canSaveConfig: boolean;
  readonly isLoadingConfig: boolean;
  readonly isSavingConfig: boolean;

  // Sync target dry-run + apply
  readonly localSyncTargetLabel: string;
  readonly onPlan: () => void | Promise<void>;
  readonly canReviewLocalConfig: boolean;
  readonly isPlanning: boolean;

  readonly confirmationText: string;
  readonly onConfirmationTextChange: (value: string) => void;
  readonly canConfirmLocalConfig: boolean;
  readonly canApplyLocalConfig: boolean;
  readonly isApplying: boolean;
  readonly onApply: () => void | Promise<void>;

  // Result slots (plan + apply rendering still owned by App)
  readonly planResultsNode: ReactNode;
  readonly applyResultsNode: ReactNode;
};

/**
 * "本地配置" tab content extracted verbatim from App.tsx.
 *
 * Stateless. App still owns every useState slice and computes the
 * derived selections (configAgent, selectedConfigAvailability,
 * canLoadConfig, ...). The panel renders the existing #config-panel
 * grid plus the embedded plan/apply result stack via the two ReactNode
 * slots so c5 can later move PlanResults / ApplyResults out of App
 * without disturbing this panel.
 */
export function LocalConfigPanel(props: LocalConfigPanelProps) {
  const selectedConfigTarget =
    props.configAgent === null ? undefined : CONFIG_TARGET_OPTIONS.find((target) => target.value === props.configAgent);
  const draftBadge = configDraftBadge({
    loaded: props.configFile !== null,
    dirty: props.configFile !== null && props.configDraft !== props.configFile.content,
  });

  return (
    <section
      className="dashboard-grid dashboard-grid--config"
      id="config-panel"
      role="tabpanel"
      aria-labelledby="config-tab"
    >
      {props.loadErrorNode}
      <article className="card config-editor-card">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">配置文件</p>
            <h2>直接查看、编辑并保存当前代理的原生配置文件。</h2>
          </div>
          <StatusBadge tone={draftBadge.tone}>{draftBadge.label}</StatusBadge>
        </div>
        <div className="config-agent-tabs" role="tablist" aria-label="选择本地配置 Agent">
          {CONFIG_TARGET_OPTIONS.map((target) => {
            const availability = props.configAvailabilityByAgent.get(target.value);
            const unavailable = availability?.available === false;
            const active = props.targetMode === target.value;
            return (
              <button
                id={`config-agent-${target.value}-tab`}
                className={`config-agent-tab ${active ? 'config-agent-tab--active' : ''}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="config-agent-panel"
                disabled={props.isLoadingConfigAvailability || unavailable}
                onClick={() => props.onTargetModeChange(target.value)}
                key={target.value}
              >
                <span className="config-agent-tab__icon" aria-hidden="true">
                  <AgentConfigIcon agent={target.value} />
                </span>
                <span>
                  <strong>{target.title}</strong>
                  <small>{unavailable ? '不可用' : target.copy}</small>
                </span>
              </button>
            );
          })}
        </div>
        <LocalConfigAgentSummary
          availability={props.selectedConfigAvailability}
          configAgent={props.configAgent}
          configFile={props.configFile}
          configPathModeLabel={props.configPathModeLabel}
          targetCopy={selectedConfigTarget?.copy}
          targetTitle={selectedConfigTarget?.title}
        />
        <div className="config-editor-toolbar">
          <div className="path-form">
            <label htmlFor="config-path-editor">
              配置路径覆盖
              <input
                id="config-path-editor"
                value={props.configPath}
                onChange={(event) => props.onConfigPathChange(event.target.value)}
                placeholder="单个配置文件、配置目录，或留空使用默认值"
                autoComplete="off"
              />
            </label>
            <div className="path-note">
              留空时使用检测到的默认原生配置；仅当所选代理的原生配置在其他文件或目录时填写。该值会同时作为 dry-run、应用的路径覆盖。
            </div>
            <div className="review-actions" aria-label="配置文件操作">
              <button className="secondary-action" type="button" onClick={props.onLoadConfigFile} disabled={!props.canLoadConfig}>
                {props.isLoadingConfig ? '正在加载...' : '加载配置'}
              </button>
              <button className="primary-action" type="button" onClick={props.onSaveConfigFile} disabled={!props.canSaveConfig}>
                {props.isSavingConfig ? '正在保存...' : '保存配置'}
              </button>
            </div>
            <div className="local-sync-panel" aria-label="本地配置同步与应用">
              <div className="path-note">
                <span>同步目标</span>
                <strong>{props.localSyncTargetLabel}</strong>
                <p>{localReviewActionCopyForAgent(props.configAgent)}</p>
              </div>
              <div className="review-actions" aria-label="本地配置 dry-run 与应用操作">
                <button className="secondary-action" type="button" onClick={props.onPlan} disabled={!props.canReviewLocalConfig}>
                  {props.isPlanning ? BUTTONS.dryRunRunning : BUTTONS.dryRun}
                </button>
              </div>
              <div className="apply-lock" aria-label="本地配置应用安全门禁">
                <div>
                  <p className="eyebrow">{GATES.applyConfirmEyebrow}</p>
                  <h3>{GATES.applyConfirmTitle}</h3>
                  <p>只有所选本地配置目标与路径匹配最新 dry-run，应用才会解锁。</p>
                </div>
                <label htmlFor="local-apply-confirmation">
                  确认文本
                  <input
                    id="local-apply-confirmation"
                    value={props.confirmationText}
                    onChange={(event) => props.onConfirmationTextChange(event.target.value)}
                    placeholder={GATES.applyConfirmPlaceholder}
                    autoComplete="off"
                    disabled={!props.canConfirmLocalConfig}
                  />
                </label>
                <button className="primary-action" type="button" onClick={props.onApply} disabled={!props.canApplyLocalConfig}>
                  {props.isApplying ? BUTTONS.applyRunning : BUTTONS.apply}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="config-editor-meta" role="status" aria-live="polite">
          <span>{props.configStatus}</span>
          {props.configFile !== null && <strong>{props.configFile.path}</strong>}
        </div>
        <div className="config-editor-body">
          <textarea
            id="config-editor"
            className="config-editor-textarea"
            value={props.configDraft}
            onChange={(event) => props.onConfigDraftChange(event.target.value)}
            placeholder="加载配置后可在此编辑原始文件内容。"
            spellCheck={false}
            wrap="off"
          />
        </div>
        <section className="review-results config-review-results" aria-label="本地配置 dry-run 与应用结果">
          {props.planResultsNode}
          {props.applyResultsNode}
        </section>
      </article>
    </section>
  );
}
