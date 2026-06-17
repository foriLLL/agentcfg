import { useEffect, useState } from 'react';
import { FileDiffViewer } from './FileDiffViewer';
import {
  applyManagedAgentSkillsRuntime,
  getManagedAgentSkillsRuntime,
  initializeManagedAgentSkillsRuntime,
  loadManagedAgentSkillsRuntime,
  planManagedAgentSkillsRuntime,
  type GitHubTokenRuntimeRequest,
  type ManagedAgentSkillsApplyResult,
  type ManagedAgentSkillsOperation,
  type ManagedAgentSkillsPlan,
  type ManagedAgentSkillsRemote,
  type ManagedAgentSkillsStatus,
} from './skills-api';
import type { RuntimeStateSummary } from './api';
import { BUTTONS, GATES } from './strings';
import { formatDate, formatError } from './view-model';

type SkillsDirectoryPanelProps = {
  requestStatePath: string | undefined;
  buildGitHubTokenRequest: () => GitHubTokenRuntimeRequest;
  onState: (state: RuntimeStateSummary) => void;
  onNotice: (tone: 'success' | 'error', title: string, copy: string) => void;
};

export function SkillsDirectoryPanel({ buildGitHubTokenRequest, onNotice, onState, requestStatePath }: SkillsDirectoryPanelProps) {
  const [status, setStatus] = useState<ManagedAgentSkillsStatus | null>(null);
  const [remote, setRemote] = useState<ManagedAgentSkillsRemote | null>(null);
  const [plan, setPlan] = useState<ManagedAgentSkillsPlan | null>(null);
  const [result, setResult] = useState<ManagedAgentSkillsApplyResult | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const canApply = plan !== null && plan.operations.length > 0 && confirmationText === 'APPLY' && !isBusy;

  useEffect(() => {
    let active = true;
    getManagedAgentSkillsRuntime({ statePath: requestStatePath })
      .then((response) => {
        if (!active) return;
        setStatus(response.skills);
        onState(response.state);
      })
      .catch((error: unknown) => {
        if (active) onNotice('error', 'Skills 状态加载失败', formatError(error));
      });
    return () => {
      active = false;
    };
  }, [requestStatePath]);

  async function refreshLocalStatus(): Promise<void> {
    const response = await getManagedAgentSkillsRuntime({ statePath: requestStatePath });
    setStatus(response.skills);
    onState(response.state);
  }

  async function handleLoadRemote(): Promise<void> {
    await runAction('远端 Skills 已加载', '可查看 Gist manifest 是否存在。', async () => {
      const response = await loadManagedAgentSkillsRuntime(buildGitHubTokenRequest());
      setRemote(response.skills);
      onState(response.state);
    });
  }

  async function handleInitializeRemote(): Promise<void> {
    await runAction('远端 Skills 已初始化', '本地 ~/.agents/skills 快照已上传到 Gist manifest。', async () => {
      const response = await initializeManagedAgentSkillsRuntime(buildGitHubTokenRequest());
      setRemote(response.skills);
      onState(response.state);
    });
  }

  async function handlePlan(): Promise<void> {
    await runAction('Skills dry-run 完成', '检查目录镜像操作后输入 APPLY 解锁写入。', async () => {
      const response = await planManagedAgentSkillsRuntime(buildGitHubTokenRequest());
      setPlan(response.plan);
      setResult(null);
      setConfirmationText('');
      onState(response.state);
    });
  }

  async function handleApply(): Promise<void> {
    if (!canApply) return;
    await runAction('Skills 已应用', '已按远端 Gist manifest 镜像本地目录，并为改写/删除文件创建备份。', async () => {
      const response = await applyManagedAgentSkillsRuntime({ ...buildGitHubTokenRequest(), confirm: 'APPLY' });
      setResult(response.result);
      setPlan(null);
      setConfirmationText('');
      onState(response.state);
      await refreshLocalStatus();
    });
  }

  async function runAction(successTitle: string, successCopy: string, action: () => Promise<void>): Promise<void> {
    setIsBusy(true);
    try {
      await action();
      onNotice('success', successTitle, successCopy);
    } catch (error) {
      onNotice('error', 'Skills 操作失败', formatError(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <article className="card rules-card">
      <div className="section-heading section-heading--split">
        <div>
          <p className="eyebrow">Agent Skills</p>
          <h2>同步 ~/.agents/skills 目录</h2>
        </div>
        <span className={`status-badge status-badge--${status?.local.exists ? 'ready' : 'pending'}`}>{status?.local.exists ? '本地目录存在' : '本地目录缺失'}</span>
      </div>

      <div className="rules-layout">
        <section className="rules-list" aria-label="Agent Skills 目录状态">
          <div className="rule-file-table" role="list">
            <div className="rule-file-row" role="listitem">
              <strong>{status?.label ?? 'Agent Skills'}</strong>
              <span>{status?.localPath ?? '~/.agents/skills'}</span>
              <small>{localSummary(status)}</small>
            </div>
            <div className="rule-file-row" role="listitem">
              <strong>{status?.gistFileName ?? 'AGENT_SKILLS.json'}</strong>
              <span>Gist manifest</span>
              <small>{remoteSummary(remote)}</small>
            </div>
          </div>
        </section>

        <section className="rules-actions" aria-label="Agent Skills 操作">
          <div className="path-note">
            <span>同步语义</span>
            <strong>远端 manifest 镜像本地目录</strong>
            <p>dry-run 会列出新增、更新、删除；skills 可能包含 scripts，请只同步可信 Gist。</p>
          </div>
          <div className="review-actions">
            <button className="secondary-action" type="button" onClick={handleLoadRemote} disabled={isBusy}>
              加载远端 Skills
            </button>
            <button className="secondary-action" type="button" onClick={handleInitializeRemote} disabled={isBusy}>
              用本地初始化远端
            </button>
            <button className="secondary-action" type="button" onClick={handlePlan} disabled={isBusy}>
              {BUTTONS.dryRun}
            </button>
          </div>
          <div className="apply-lock">
            <div>
              <p className="eyebrow">{GATES.applyConfirmEyebrow}</p>
              <h3>{GATES.applyConfirmTitle}</h3>
              <p>远端缺失的本地文件会被删除；写入和删除前会创建备份。</p>
            </div>
            <label htmlFor="skills-apply-confirmation">
              确认文本
              <input id="skills-apply-confirmation" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder={GATES.applyConfirmPlaceholder} autoComplete="off" disabled={plan === null || plan.operations.length === 0 || isBusy} />
            </label>
            <button className="primary-action" type="button" onClick={handleApply} disabled={!canApply}>
              {BUTTONS.apply}
            </button>
          </div>
        </section>
      </div>

      <SkillsResults plan={plan} result={result} />
    </article>
  );
}

function localSummary(status: ManagedAgentSkillsStatus | null): string {
  if (status === null) return '正在读取本地目录。';
  if (!status.local.exists) return '本地缺失，初始化远端会上传空 manifest。';
  return `${status.local.fileCount} 个文件，${formatBytes(status.local.totalBytes)}，更新于 ${formatDate(status.local.updatedAt)}`;
}

function remoteSummary(remote: ManagedAgentSkillsRemote | null): string {
  if (remote === null) return '加载远端后可查看 manifest 状态。';
  if (remote.remote.status === 'missing') return '远端缺失，可用本地目录初始化。';
  return `${remote.remote.summary.fileCount} 个文件，${formatBytes(remote.remote.summary.totalBytes)}`;
}

function SkillsResults({ plan, result }: { plan: ManagedAgentSkillsPlan | null; result: ManagedAgentSkillsApplyResult | null }) {
  return (
    <section className="review-results rules-results" aria-label="Agent Skills dry-run 与应用结果">
      {plan !== null && (
        <article className="result-card">
          <div className="section-heading section-heading--split">
            <h3>{plan.label}</h3>
            <span className="status-badge status-badge--warning">{plan.status === 'would-change' ? `${plan.operations.length} 项变更` : '无变化'}</span>
          </div>
          {plan.operations.map((operation) => <SkillOperation operation={operation} key={`${operation.action}:${operation.path}`} />)}
        </article>
      )}
      {result !== null && (
        <article className="result-card">
          <h3>{result.label}</h3>
          <p>{result.status}，{result.changedCount} 项变更，{result.backupPaths.length} 个备份。</p>
          {result.error !== undefined && <p>{result.error}</p>}
        </article>
      )}
    </section>
  );
}

function SkillOperation({ operation }: { operation: ManagedAgentSkillsOperation }) {
  return (
    <div className="field-grid">
      <div className="field-row">
        <strong>{operationLabel(operation.action)}</strong>
        <span>{operation.path}</span>
        <span>{operation.contentKind === 'text' ? `mode ${operation.expectedMode ?? '-'}` : 'binary'}</span>
      </div>
      {operation.contentKind === 'text' && (
        <FileDiffViewer path={operation.path} currentContent={operation.currentContent ?? ''} expectedContent={operation.expectedContent ?? ''} />
      )}
    </div>
  );
}

function operationLabel(action: ManagedAgentSkillsOperation['action']): string {
  if (action === 'create') return '新增';
  if (action === 'update') return '更新';
  return '删除';
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
