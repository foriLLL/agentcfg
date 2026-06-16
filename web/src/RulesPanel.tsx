import { useEffect, useMemo, useState } from 'react';
import { FileDiffViewer } from './FileDiffViewer';
import {
  applyManagedRuleFilesRuntime,
  getManagedRuleFilesRuntime,
  initializeManagedRuleFileRuntime,
  loadManagedRuleFilesRuntime,
  planManagedRuleFilesRuntime,
  type ManagedRuleFileApplyResult,
  type ManagedRuleFilePlan,
  type ManagedRuleFileRemote,
  type ManagedRuleFileStatus,
  type RuntimeStateSummary,
} from './api';
import { formatDate, formatError } from './view-model';

type GitHubTokenRequest = {
  statePath?: string;
  githubToken?: string;
  rememberGitHubToken?: boolean;
};

type RulesPanelProps = {
  runtimeState: RuntimeStateSummary | null;
  requestStatePath: string | undefined;
  buildGitHubTokenRequest: () => GitHubTokenRequest;
  onState: (state: RuntimeStateSummary) => void;
  onNotice: (tone: 'success' | 'error', title: string, copy: string) => void;
};

type RuleSelection = string | 'all';

export function RulesPanel({ buildGitHubTokenRequest, onNotice, onState, requestStatePath, runtimeState }: RulesPanelProps) {
  const [files, setFiles] = useState<ManagedRuleFileStatus[]>([]);
  const [remoteFiles, setRemoteFiles] = useState<ManagedRuleFileRemote[]>([]);
  const [plans, setPlans] = useState<ManagedRuleFilePlan[]>([]);
  const [results, setResults] = useState<ManagedRuleFileApplyResult[]>([]);
  const [selection, setSelection] = useState<RuleSelection>('codex-agents');
  const [confirmationText, setConfirmationText] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getManagedRuleFilesRuntime({ statePath: requestStatePath })
      .then((response) => {
        if (!active) return;
        setFiles(response.files);
        onState(response.state);
      })
      .catch((error: unknown) => {
        if (active) onNotice('error', '规则文件状态加载失败', formatError(error));
      });
    return () => {
      active = false;
    };
  }, [requestStatePath]);

  const selectedFile = useMemo(() => files.find((file) => file.id === selection), [files, selection]);
  const selectedRemote = useMemo(() => remoteFiles.find((file) => file.id === selection), [remoteFiles, selection]);
  const canApply = plans.length > 0 && confirmationText === 'APPLY' && !isBusy;

  async function refreshLocalStatus(): Promise<void> {
    const response = await getManagedRuleFilesRuntime({ statePath: requestStatePath });
    setFiles(response.files);
    onState(response.state);
  }

  async function handleLoadRemote(): Promise<void> {
    await runAction('远端规则文件已加载', '可查看每个 Gist 文件是否存在。', async () => {
      const response = await loadManagedRuleFilesRuntime(buildGitHubTokenRequest());
      setRemoteFiles(response.files);
      onState(response.state);
    });
  }

  async function handleInitializeRemote(): Promise<void> {
    if (selection === 'all') {
      onNotice('error', '请选择单个规则文件', '初始化远端文件需要选择一个本地文件作为来源。');
      return;
    }
    await runAction('远端规则文件已初始化', '本地内容已上传到对应 Gist 文件。', async () => {
      const response = await initializeManagedRuleFileRuntime({ ...buildGitHubTokenRequest(), id: selection });
      setRemoteFiles((current) => mergeRemoteFiles(current, response.files));
      onState(response.state);
    });
  }

  async function handlePlan(): Promise<void> {
    await runAction('规则文件 dry-run 完成', '检查差异后输入 APPLY 解锁写入。', async () => {
      const response = await planManagedRuleFilesRuntime({ ...buildGitHubTokenRequest(), ...selectionRequest(selection) });
      setPlans(response.plans);
      setResults([]);
      setConfirmationText('');
      onState(response.state);
    });
  }

  async function handleApply(): Promise<void> {
    if (!canApply) return;
    await runAction('规则文件已应用', '已按远端 Gist 内容写入本地，并在写入前创建备份。', async () => {
      const response = await applyManagedRuleFilesRuntime({
        ...buildGitHubTokenRequest(),
        ...selectionRequest(selection),
        confirm: 'APPLY',
      });
      setResults(response.results);
      setPlans([]);
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
      onNotice('error', '规则文件操作失败', formatError(error));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="dashboard-grid dashboard-grid--rules" id="rules-panel" role="tabpanel" aria-labelledby="rules-tab">
      <article className="card rules-card">
        <div className="section-heading section-heading--split">
          <div>
            <p className="eyebrow">规则文件</p>
            <h2>同步官方用户级规则文件</h2>
          </div>
          <span className="status-badge status-badge--pending">{runtimeState?.gist.present ? '使用当前 Gist' : '等待连接'}</span>
        </div>

        <div className="rules-layout">
          <section className="rules-list" aria-label="规则文件列表">
            <label htmlFor="rule-file-selection">
              同步目标
              <select id="rule-file-selection" value={selection} onChange={(event) => setSelection(event.target.value)}>
                {files.map((file) => <option value={file.id} key={file.id}>{file.label}</option>)}
                <option value="all">全部规则文件</option>
              </select>
            </label>
            <div className="rule-file-table" role="list">
              {files.map((file) => (
                <div className="rule-file-row" key={file.id} role="listitem">
                  <strong>{file.label}</strong>
                  <span>{file.localPath}</span>
                  <small>{file.local.exists ? `本地存在，更新于 ${formatDate(file.local.updatedAt)}` : '本地缺失，应用时会创建'}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="rules-actions" aria-label="规则文件操作">
            <div className="path-note">
              <span>当前选择</span>
              <strong>{selection === 'all' ? '全部规则文件' : selectedFile?.gistFileName ?? '未加载'}</strong>
              <p>{selection === 'all' ? 'dry-run 和应用会处理三项官方规则文件。' : selectedRemoteCopy(selectedRemote)}</p>
            </div>
            <div className="review-actions">
              <button className="secondary-action" type="button" onClick={handleLoadRemote} disabled={isBusy}>
                加载远端文件
              </button>
              <button className="secondary-action" type="button" onClick={handleInitializeRemote} disabled={isBusy || selection === 'all'}>
                用本地初始化远端
              </button>
              <button className="secondary-action" type="button" onClick={handlePlan} disabled={isBusy}>
                执行 dry-run
              </button>
            </div>
            <div className="apply-lock">
              <div>
                <p className="eyebrow">强确认门禁</p>
                <h3>输入 APPLY 后写入规则文件。</h3>
                <p>远端 Gist 内容会覆盖本地；写入前会创建备份。</p>
              </div>
              <label htmlFor="rules-apply-confirmation">
                确认文本
                <input id="rules-apply-confirmation" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} placeholder="APPLY" autoComplete="off" disabled={plans.length === 0 || isBusy} />
              </label>
              <button className="primary-action" type="button" onClick={handleApply} disabled={!canApply}>
                应用规则文件
              </button>
            </div>
          </section>
        </div>

        <RulesResults plans={plans} results={results} />
      </article>
    </section>
  );
}

function selectionRequest(selection: RuleSelection): { id?: string } {
  return selection === 'all' ? {} : { id: selection };
}

function selectedRemoteCopy(file: ManagedRuleFileRemote | undefined): string {
  if (file === undefined) return '加载远端文件后可查看 Gist 文件状态。';
  return file.remote.status === 'available' ? '远端文件存在，可 dry-run 或应用。' : '远端文件缺失，可用本地内容初始化。';
}

function mergeRemoteFiles(current: ManagedRuleFileRemote[], next: ManagedRuleFileRemote[]): ManagedRuleFileRemote[] {
  const byId = new Map(current.map((file) => [file.id, file]));
  for (const file of next) byId.set(file.id, file);
  return [...byId.values()];
}

function RulesResults({ plans, results }: { plans: ManagedRuleFilePlan[]; results: ManagedRuleFileApplyResult[] }) {
  return (
    <section className="review-results rules-results" aria-label="规则文件 dry-run 与应用结果">
      {plans.map((plan) => (
        <article className="result-card" key={plan.id}>
          <div className="section-heading section-heading--split">
            <h3>{plan.label}</h3>
            <span className="status-badge status-badge--warning">{plan.status === 'would-change' ? '将会变更' : '无变化'}</span>
          </div>
          <FileDiffViewer path={plan.localPath} currentContent={plan.currentContent ?? ''} expectedContent={plan.expectedContent} />
        </article>
      ))}
      {results.map((result) => (
        <article className="result-card" key={result.id}>
          <h3>{result.label}</h3>
          <p>{result.status}{result.backupPath === undefined ? '' : `，备份：${result.backupPath}`}</p>
          {result.error !== undefined && <p>{result.error}</p>}
        </article>
      ))}
    </section>
  );
}
