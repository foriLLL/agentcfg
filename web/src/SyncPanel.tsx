import { useEffect, useMemo, useState } from 'react';
import {
  getSyncServiceRuntime,
  installSyncServiceRuntime,
  saveAutoSyncRuntime,
  syncNowRuntime,
  uninstallSyncServiceRuntime,
  type AutoSyncConfig,
  type RuntimeStateSummary,
  type SyncOnceResult,
  type SyncServiceStatus,
} from './api';
import { agentLabel, formatDate, formatError } from './view-model';

type GitHubTokenRequest = {
  statePath?: string;
  githubToken?: string;
  rememberGitHubToken?: boolean;
};

type SyncPanelProps = {
  runtimeState: RuntimeStateSummary | null;
  requestStatePath: string | undefined;
  buildGitHubTokenRequest: () => GitHubTokenRequest;
  onState: (state: RuntimeStateSummary) => void;
  onNotice: (tone: 'success' | 'error', title: string, copy: string) => void;
};

const SYNC_TARGETS = [
  { id: 'codex', label: 'Codex' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'openclaw', label: 'OpenClaw' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'ohmyopenagent', label: 'OhMyOpenAgent' },
  { id: 'ruleFiles', label: '规则文件' },
] as const;

const DEFAULT_AUTO_SYNC: AutoSyncConfig = {
  enabled: false,
  intervalMinutes: 60,
  targets: SYNC_TARGETS.map((target) => target.id),
};

export function SyncPanel({ buildGitHubTokenRequest, onNotice, onState, requestStatePath, runtimeState }: SyncPanelProps) {
  const [draft, setDraft] = useState<AutoSyncConfig>(runtimeState?.autoSync ?? DEFAULT_AUTO_SYNC);
  const [service, setService] = useState<SyncServiceStatus | null>(null);
  const [lastResult, setLastResult] = useState<SyncOnceResult | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    setDraft(runtimeState?.autoSync ?? DEFAULT_AUTO_SYNC);
  }, [runtimeState?.autoSync]);

  useEffect(() => {
    let active = true;
    getSyncServiceRuntime({ statePath: requestStatePath })
      .then((response) => {
        if (!active) return;
        setService(response.service);
        onState(response.state);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [requestStatePath]);

  const targetSummary = useMemo(
    () => draft.targets.map((target) => targetLabel(target)).join('、') || '未选择',
    [draft.targets],
  );

  async function handleSave(): Promise<void> {
    await runAction('自动同步设置已保存', '后台服务会按这里的间隔和目标执行。', async () => {
      const response = await saveAutoSyncRuntime({ ...buildGitHubTokenRequest(), autoSync: draft });
      onState(response.state);
    });
  }

  async function handleSyncNow(): Promise<void> {
    await runAction('已执行一次同步', '结果已记录到本地状态。', async () => {
      const response = await syncNowRuntime({ ...buildGitHubTokenRequest(), targets: draft.targets });
      setLastResult(response.result);
      onState(response.state);
    });
  }

  async function handleInstall(): Promise<void> {
    await runAction('后台同步服务已安装', '系统会按配置的间隔运行 agentcfg sync once。', async () => {
      const settings = await saveAutoSyncRuntime({ ...buildGitHubTokenRequest(), autoSync: draft });
      onState(settings.state);
      const response = await installSyncServiceRuntime({
        statePath: requestStatePath,
        intervalMinutes: draft.intervalMinutes,
      });
      setService(response.service);
      onState(response.state);
    });
  }

  async function handleUninstall(): Promise<void> {
    await runAction('后台同步服务已卸载', '系统定时任务已移除，本地设置仍保留。', async () => {
      const response = await uninstallSyncServiceRuntime({ statePath: requestStatePath });
      setService(response.service);
      onState(response.state);
    });
  }

  async function handleRefreshService(): Promise<void> {
    await runAction('服务状态已刷新', '已重新读取当前系统后台任务状态。', async () => {
      const response = await getSyncServiceRuntime({ statePath: requestStatePath });
      setService(response.service);
      onState(response.state);
    });
  }

  async function runAction(successTitle: string, successCopy: string, action: () => Promise<void>): Promise<void> {
    setIsBusy(true);
    try {
      await action();
      onNotice('success', successTitle, successCopy);
    } catch (error) {
      onNotice('error', '自动同步操作失败', formatError(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="dashboard-grid dashboard-grid--sync" id="sync-panel" role="tabpanel" aria-labelledby="sync-tab">
      <article className="card sync-card">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">自动同步</p>
            <h2>配置系统后台定时同步</h2>
          </div>
          <span className={`status-badge status-badge--${service?.installed ? 'ready' : 'pending'}`}>
            {service?.installed ? '服务已安装' : '服务未安装'}
          </span>
        </div>

        <div className="sync-layout">
          <section className="sync-settings" aria-label="自动同步设置">
            <label className="checkbox-control" htmlFor="auto-sync-enabled">
              <input id="auto-sync-enabled" type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
              <span>启用自动同步</span>
            </label>
            <label htmlFor="auto-sync-interval">
              更新间隔（分钟）
              <input id="auto-sync-interval" type="number" min="1" step="1" value={draft.intervalMinutes} onChange={(event) => setDraft({ ...draft, intervalMinutes: normalizeInterval(event.target.value) })} />
            </label>
            <fieldset className="target-grid sync-target-grid">
              <legend>自动同步目标</legend>
              {SYNC_TARGETS.map((target) => (
                <label className="target-option" key={target.id}>
                  <input type="checkbox" checked={draft.targets.includes(target.id)} onChange={(event) => setDraft(withTarget(draft, target.id, event.target.checked))} />
                  <span>
                    <strong>{target.label}</strong>
                    <small>{target.id === 'ruleFiles' ? 'AGENTS.md、CLAUDE.md、GEMINI.md' : `${target.label} 原生配置`}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="path-note">
              <span>当前目标</span>
              <strong>{targetSummary}</strong>
            </div>
            <div className="review-actions">
              <button className="primary-action" type="button" onClick={handleSave} disabled={isBusy || draft.targets.length === 0}>
                保存自动同步设置
              </button>
              <button className="secondary-action" type="button" onClick={handleSyncNow} disabled={isBusy || draft.targets.length === 0}>
                立即同步一次
              </button>
            </div>
          </section>

          <section className="sync-service" aria-label="后台服务">
            <div className="path-note">
              <span>系统服务</span>
              <strong>{service?.message ?? '尚未读取服务状态'}</strong>
              <p>{service?.paths.join('、') ?? '安装后会生成对应平台的系统定时任务。'}</p>
            </div>
            <div className="review-actions">
              <button className="secondary-action" type="button" onClick={handleRefreshService} disabled={isBusy}>
                刷新服务状态
              </button>
              <button className="primary-action" type="button" onClick={handleInstall} disabled={isBusy || draft.targets.length === 0}>
                安装后台服务
              </button>
              <button className="secondary-action" type="button" onClick={handleUninstall} disabled={isBusy}>
                卸载后台服务
              </button>
            </div>
            <SyncRunSummary result={lastResult} state={runtimeState} />
          </section>
        </div>
      </article>
    </section>
  );
}

function withTarget(config: AutoSyncConfig, target: string, checked: boolean): AutoSyncConfig {
  const targets = checked ? [...config.targets, target] : config.targets.filter((entry) => entry !== target);
  return { ...config, targets: [...new Set(targets)] };
}

function normalizeInterval(value: string): number {
  const interval = Number(value);
  return Number.isInteger(interval) && interval > 0 ? interval : 1;
}

function targetLabel(target: string): string {
  if (target === 'ruleFiles') return '规则文件';
  if (target === 'codex' || target === 'opencode' || target === 'openclaw' || target === 'claude' || target === 'ohmyopenagent') {
    return agentLabel(target);
  }
  return target;
}

function SyncRunSummary({ result, state }: { result: SyncOnceResult | null; state: RuntimeStateSummary | null }) {
  const run = result ?? state?.lastSyncRun;
  if (run === undefined || run === null) {
    return <div className="mini-empty"><h3>暂无同步结果</h3><p>保存设置后可以立即同步一次。</p></div>;
  }
  return (
    <dl className="detail-list">
      <div><dt>结果</dt><dd>{run.status}</dd></div>
      <div><dt>开始</dt><dd>{formatDate(run.startedAt)}</dd></div>
      <div><dt>结束</dt><dd>{formatDate(run.completedAt)}</dd></div>
      <div><dt>说明</dt><dd>{run.message ?? '无'}</dd></div>
    </dl>
  );
}
