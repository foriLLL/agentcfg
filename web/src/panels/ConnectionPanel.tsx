import type { ReactNode, SyntheticEvent } from 'react';
import type { RuntimeStateSummary } from '../api';
import { gistConnectionBadge } from '../strings';
import { Detail, StatusBadge } from '../widgets';
import type { Step } from '../view-model';
import { statusTone } from '../view-model';

export type ConnectionPanelProps = {
  readonly runtimeState: RuntimeStateSummary | null;
  readonly loadErrorNode: ReactNode;

  // GitHub token form
  readonly githubToken: string;
  readonly githubTokenInputValue: string;
  readonly githubTokenPlaceholder: string;
  readonly onGithubTokenChange: (value: string) => void;

  readonly gistId: string;
  readonly onGistIdChange: (value: string) => void;

  readonly statePath: string;
  readonly onStatePathChange: (value: string) => void;

  readonly rememberGitHubToken: boolean;
  readonly onRememberGitHubTokenChange: (checked: boolean) => void;
  readonly rememberCheckboxChecked: boolean;
  readonly rememberCheckboxLabel: string;

  // saved-token controls
  readonly hasSavedGitHubToken: boolean;
  readonly isEditingGitHubToken: boolean;
  readonly savedTokenStatusCopy: string;
  readonly onEditSavedGitHubToken: () => void;
  readonly onCancelGitHubTokenEdit: () => void;
  readonly onClearSavedGitHubToken: () => void;

  // submit + busy flags
  readonly onInitSubmit: (event: SyntheticEvent<HTMLFormElement>) => void | Promise<void>;
  readonly submitButtonLabel: string;

  readonly isGitHubTokenLocked: boolean;
  readonly isSubmittingInit: boolean;
  readonly isSettingRemote: boolean;
  readonly isReplacingSavedGitHubToken: boolean;
  readonly isClearingGitHubToken: boolean;
  readonly isBusy: boolean;

  readonly setupSteps: readonly Step[];
};

/**
 * "Gist 连接" tab content extracted verbatim from App.tsx.
 *
 * Behavior is unchanged: this component owns no state. Every form value,
 * flag, and handler is passed in. The panel only renders the existing JSX
 * tree under #connection-panel, plus the session card to its right.
 */
export function ConnectionPanel(props: ConnectionPanelProps) {
  const gistBadge = gistConnectionBadge(props.runtimeState);

  return (
    <section
      className="dashboard-grid dashboard-grid--connection"
      id="connection-panel"
      role="tabpanel"
      aria-labelledby="connection-tab"
    >
      {props.loadErrorNode}
      <article className="card onboarding-card connection-card" id="setup-panel">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">初始化</p>
            <h2>连接状态</h2>
          </div>
          <StatusBadge tone={gistBadge.tone}>{gistBadge.label}</StatusBadge>
        </div>
        <form className="setup-form" onSubmit={props.onInitSubmit}>
          <label htmlFor="github-token">
            GitHub Token
            <input
              id="github-token"
              name="github-token"
              type="password"
              value={props.githubTokenInputValue}
              onChange={(event) => props.onGithubTokenChange(event.target.value)}
              placeholder={props.githubTokenPlaceholder}
              autoComplete="off"
              disabled={props.isGitHubTokenLocked || props.isSubmittingInit || props.isSettingRemote}
            />
          </label>
          <label htmlFor="gist-id">
            Gist ID（高级兼容，可选）
            <input
              id="gist-id"
              name="gist-id"
              value={props.gistId}
              onChange={(event) => props.onGistIdChange(event.target.value)}
              placeholder="私有 Gist ID"
              autoComplete="off"
              disabled={props.isSubmittingInit}
            />
          </label>
          <label htmlFor="state-path">
            状态路径（可选）
            <input
              id="state-path"
              name="state-path"
              value={props.statePath}
              onChange={(event) => props.onStatePathChange(event.target.value)}
              placeholder={props.runtimeState?.statePath ?? '~/.agentcfg/state.json'}
              autoComplete="off"
              disabled={props.isSubmittingInit}
            />
          </label>
          {!props.hasSavedGitHubToken && (
            <label className="checkbox-control" htmlFor="remember-github-token">
              <input
                id="remember-github-token"
                name="remember-github-token"
                type="checkbox"
                checked={props.rememberCheckboxChecked}
                onChange={(event) => props.onRememberGitHubTokenChange(event.target.checked)}
                disabled={props.isSubmittingInit || props.isSettingRemote || props.githubToken.trim() === ''}
              />
              <span>{props.rememberCheckboxLabel}</span>
            </label>
          )}
          <div className="saved-token-control" role="status" aria-live="polite">
            <span>{props.savedTokenStatusCopy}</span>
            <div className="saved-token-actions" aria-label="保存的 GitHub Token 操作">
              {props.hasSavedGitHubToken && !props.isEditingGitHubToken && (
                <button className="secondary-action secondary-action--compact" type="button" onClick={props.onEditSavedGitHubToken} disabled={props.isBusy}>
                  编辑保存的 Token
                </button>
              )}
              {props.hasSavedGitHubToken && props.isEditingGitHubToken && (
                <button className="secondary-action secondary-action--compact" type="button" onClick={props.onCancelGitHubTokenEdit} disabled={props.isBusy}>
                  取消编辑
                </button>
              )}
              <button
                className="secondary-action secondary-action--compact"
                type="button"
                onClick={props.onClearSavedGitHubToken}
                disabled={!props.hasSavedGitHubToken || props.isClearingGitHubToken}
              >
                {props.isClearingGitHubToken ? '正在清除...' : '清除保存的 Token'}
              </button>
            </div>
          </div>
          <button className="primary-action" type="submit" disabled={props.isSubmittingInit || props.isSettingRemote}>
            {props.submitButtonLabel}
          </button>
        </form>
        <p className="helper-copy">
          若没有现有 agentcfg Gist，在“远端配置”保存时会自动创建 secret Gist。
        </p>
        <div className="step-list" aria-label="设置进度">
          {props.setupSteps.map((step) => (
            <div className="step-row" key={step.title}>
              <span className={`step-marker step-marker--${step.state}`} aria-hidden="true" />
              <div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="card session-card" aria-label="当前本地状态摘要">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">会话</p>
            <h2>本地状态摘要</h2>
          </div>
          <span className={`status-dot status-dot--${statusTone(props.runtimeState)}`} aria-hidden="true" />
        </div>
        <dl className="detail-list">
          <Detail label="状态路径" value={props.runtimeState?.statePath ?? '正在解析本地状态...'} />
          <Detail label="来源" value={props.runtimeState?.gist.present ? `Gist ${props.runtimeState.gist.id}` : '未初始化'} />
          <Detail label="远端基线" value={props.runtimeState?.conflict.present ? '已保存用于后续比对' : '尚未保存'} />
        </dl>
      </article>
    </section>
  );
}
