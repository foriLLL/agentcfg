import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { AGENTCFG_SCHEMA_DOCS } from '../../src/core/schema-docs';
import { FileDiffViewer } from './FileDiffViewer';
import {
  RuntimeClientError,
  type EditableAgentConfig,
  applyRuntime,
  clearSavedGitHubTokenRuntime,
  diffRuntime,
  getConfigFileRuntime,
  getRuntimeState,
  initRuntime,
  loadRemoteConfigRuntime,
  planApplyRuntime,
  pullRuntime,
  saveConfigFileRuntime,
  saveRemoteConfigRuntime,
  setupRemoteConfigRuntime,
  type AgentConfig,
  type AgentDiffResult,
  type AgentName,
  type ApplyAgentResult,
  type ApplyFilePreview,
  type ApplyPlanSummary,
  type ConfigFileRuntimeResponse,
  type DiffRuntimeResponse,
  type ManagedDiffChange,
  type ManagedField,
  type PlanApplyRuntimeResponse,
  type RuntimeStateSummary,
  type RuntimeTargetRequest,
} from './api';

type Notice = {
  tone: 'success' | 'error';
  title: string;
  copy: string;
};

type StepState = 'ready' | 'pending' | 'locked';

type Step = {
  title: string;
  copy: string;
  state: StepState;
};

type TargetMode = AgentName | 'all' | '';

type AppTab = 'connection' | 'remote' | 'config' | 'execute' | 'status';

const TARGET_OPTIONS: Array<{ value: Exclude<TargetMode, ''>; title: string; copy: string }> = [
  { value: 'codex', title: 'Codex', copy: '检查 ~/.codex 设置与生成的 env 文件。' },
  { value: 'opencode', title: 'OpenCode', copy: '检查一个 OpenCode JSON 或 JSONC 配置。' },
  { value: 'openclaw', title: 'OpenClaw', copy: '检查一个 OpenClaw JSON 或 JSON5 配置。' },
  { value: 'all', title: '全部代理', copy: '同时处理 Codex、OpenCode 与 OpenClaw。' },
];

const CONFIG_TARGET_OPTIONS: Array<{ value: AgentName; title: string; copy: string }> = [
  { value: 'codex', title: 'Codex', copy: '查看 Codex TOML 配置原文。' },
  { value: 'opencode', title: 'OpenCode', copy: '查看 OpenCode JSON/JSONC 配置原文。' },
  { value: 'openclaw', title: 'OpenClaw', copy: '查看 OpenClaw JSON/JSON5 配置原文。' },
];

const MANAGED_FIELDS: ManagedField[] = ['provider', 'model', 'baseURL', 'apiKey'];

const EMPTY_REMOTE_CONFIG: EditableAgentConfig = {
  schemaVersion: 1,
  provider: 'openai',
  model: 'gpt-4.1-mini',
  baseURL: 'https://api.openai.com/v1',
  apiKey: {
    type: 'plain',
    value: '',
  },
};

const SAVED_GITHUB_TOKEN_MASK = '************';

function App() {
  const [runtimeState, setRuntimeState] = useState<RuntimeStateSummary | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [githubToken, setGithubToken] = useState('');
  const [isEditingGitHubToken, setIsEditingGitHubToken] = useState(false);
  const [rememberGitHubToken, setRememberGitHubToken] = useState(false);
  const [gistId, setGistId] = useState('');
  const [statePath, setStatePath] = useState('');
  const [configPath, setConfigPath] = useState('');
  const [remoteDraft, setRemoteDraft] = useState<EditableAgentConfig>(EMPTY_REMOTE_CONFIG);
  const [remoteStatus, setRemoteStatus] = useState('输入 GitHub Token 后，应用会发现现有 agentcfg Gist；没有时会在保存远端配置时自动创建。');
  const [targetMode, setTargetMode] = useState<TargetMode>('');
  const [diffResponse, setDiffResponse] = useState<DiffRuntimeResponse | null>(null);
  const [planResponse, setPlanResponse] = useState<PlanApplyRuntimeResponse | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [applyResults, setApplyResults] = useState<ApplyAgentResult[] | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [activeTab, setActiveTab] = useState<AppTab>('connection');
  const [configFile, setConfigFile] = useState<ConfigFileRuntimeResponse | null>(null);
  const [configDraft, setConfigDraft] = useState('');
  const [configStatus, setConfigStatus] = useState('尚未加载配置文件。');
  const [isSubmittingInit, setIsSubmittingInit] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isDiffing, setIsDiffing] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isSettingRemote, setIsSettingRemote] = useState(false);
  const [isLoadingRemote, setIsLoadingRemote] = useState(false);
  const [isSavingRemote, setIsSavingRemote] = useState(false);
  const [isClearingGitHubToken, setIsClearingGitHubToken] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  useEffect(() => {
    let active = true;

    getRuntimeState()
      .then(({ state }) => {
        if (!active) {
          return;
        }
        commitRuntimeState(state);
        setLoadState('ready');
        setGistId(state.gist.id ?? '');
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setLoadState('error');
        setNotice({ tone: 'error', title: '无法加载状态', copy: formatError(error) });
      });

    return () => {
      active = false;
    };
  }, []);

  const setupSteps = useMemo<Step[]>(() => buildSetupSteps(runtimeState), [runtimeState]);
  const requestStatePath = statePath.trim() === '' ? runtimeState?.statePath : statePath.trim();
  const targetRequest = useMemo<RuntimeTargetRequest | null>(() => {
    if (targetMode === '') {
      return null;
    }

    return {
      statePath: requestStatePath,
      ...(targetMode === 'all' ? { allAgents: true } : { agent: targetMode }),
      configPath: configPath.trim(),
    };
  }, [configPath, requestStatePath, targetMode]);
  const reviewKey = targetRequest === null ? '' : JSON.stringify(targetRequest);
  const isPlanCurrent = planResponse !== null && planKey === reviewKey;
  const hasSavedGitHubToken = runtimeState?.secrets?.hasGitHubToken === true;
  const isBusy = isSubmittingInit || isPulling || isDiffing || isPlanning || isApplying || isSettingRemote || isLoadingRemote || isSavingRemote || isClearingGitHubToken || loadState === 'loading';
  const canReview = targetRequest !== null && runtimeState?.cache.present === true && !isBusy;
  const canApply = targetRequest !== null && isPlanCurrent && confirmationText === 'APPLY' && !isBusy;
  const configAgent = targetMode === 'codex' || targetMode === 'opencode' || targetMode === 'openclaw' ? targetMode : null;
  const configBusy = isLoadingConfig || isSavingConfig;
  const canLoadConfig = configAgent !== null && !configBusy;
  const canSaveConfig = configAgent !== null && configFile !== null && configDraft !== configFile.content && !configBusy;
  const isGitHubTokenLocked = hasSavedGitHubToken && !isEditingGitHubToken;
  const isReplacingSavedGitHubToken = hasSavedGitHubToken && isEditingGitHubToken;
  const githubTokenInputValue = isGitHubTokenLocked ? SAVED_GITHUB_TOKEN_MASK : githubToken;
  const shouldRememberGitHubToken = isReplacingSavedGitHubToken ? githubToken.trim() !== '' : rememberGitHubToken;
  const remoteYamlPreview = useMemo(() => buildRemoteYamlPreview(remoteDraft), [remoteDraft]);

  useEffect(() => {
    setConfirmationText('');
  }, [reviewKey]);

  useEffect(() => {
    setConfigFile(null);
    setConfigDraft('');
    setConfigStatus(configAgent === null ? '请选择 Codex、OpenCode 或 OpenClaw 后再加载配置文件。' : '尚未加载配置文件。');
  }, [configAgent, configPath, requestStatePath]);

  function commitRuntimeState(state: RuntimeStateSummary): void {
    setRuntimeState(state);
    setStatePath(state.statePath);
    if (state.secrets?.hasGitHubToken === true) {
      setGithubToken('');
      setRememberGitHubToken(false);
      setIsEditingGitHubToken(false);
    }
  }

  async function refreshState(nextStatePath?: string): Promise<void> {
    const { state } = await getRuntimeState(nextStatePath);
    commitRuntimeState(state);
    setGistId(state.gist.id ?? gistId);
    setLoadState('ready');
  }

  async function handleInitSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextGistId = gistId.trim();
    const nextStatePath = statePath.trim();
    const nextGithubToken = githubToken.trim();

    if (nextGithubToken !== '' || nextGistId === '') {
      await handleRemoteSetup(nextGithubToken, nextStatePath);
      return;
    }

    if (nextGistId === '') {
      setNotice({
        tone: 'error',
        title: '需要 GitHub Token',
        copy: '请输入 GitHub Token 自动配置远端，或使用已保存的 Token；如已知道 Gist ID，也可以填写高级兼容项。',
      });
      return;
    }

    setIsSubmittingInit(true);
    setNotice(null);
    try {
      const { state } = await initRuntime({ gistId: nextGistId, statePath: nextStatePath });
      commitRuntimeState(state);
      await refreshState(nextStatePath);
      setNotice({
        tone: 'success',
        title: '状态已连接',
        copy: 'agentcfg 已保存 Gist 身份。准备好后即可拉取远端配置。',
      });
    } catch (error) {
      setNotice({ tone: 'error', title: '初始化失败', copy: formatError(error) });
    } finally {
      setIsSubmittingInit(false);
    }
  }

  async function handlePull(): Promise<void> {
    setIsPulling(true);
    setNotice(null);
    try {
      const { state } = await pullRuntime(githubTokenRequest(requestStatePath));
      commitRuntimeState(state);
      setDiffResponse(null);
      setPlanResponse(null);
      setPlanKey(null);
      setApplyResults(null);
      setNotice({
        tone: 'success',
        title: '已拉取远端配置',
        copy: '控制台现在显示最新的本地缓存与完整代理配置，包括 API Key。',
      });
    } catch (error) {
      setNotice({ tone: 'error', title: '拉取需要处理', copy: formatError(error) });
    } finally {
      setIsPulling(false);
    }
  }

  async function handleRemoteSetup(nextGithubToken = githubToken.trim(), nextStatePath = statePath.trim()): Promise<void> {
    setIsSettingRemote(true);
    setNotice(null);
    try {
      const response = await setupRemoteConfigRuntime(githubTokenRequest(nextStatePath, nextGithubToken));
      commitRuntimeState(response.state);
      setGistId(response.state.gist.id ?? '');
      if (response.config !== undefined) {
        setRemoteDraft(configToDraft(response.config));
        setRemoteStatus('已发现并加载远端配置。表单显示的是当前远端完整值。');
      } else {
        setRemoteDraft(EMPTY_REMOTE_CONFIG);
        setRemoteStatus('没有找到现有 agentcfg Gist。填写远端配置并保存后，会自动创建 secret Gist。');
      }
      setActiveTab('remote');
      setNotice({ tone: 'success', title: response.state.gist.present ? '状态已连接' : '准备创建远端配置', copy: response.state.gist.present ? '已找到现有 agentcfg Gist，可以继续编辑远端配置。' : '填写远端配置后保存，即可自动创建 agentcfg Gist。' });
    } catch (error) {
      setNotice({ tone: 'error', title: 'Token 配置失败', copy: formatError(error) });
    } finally {
      setIsSettingRemote(false);
    }
  }

  async function handleLoadRemoteConfig(): Promise<void> {
    const nextGithubToken = githubToken.trim();

    setIsLoadingRemote(true);
    setNotice(null);
    try {
      const response = await loadRemoteConfigRuntime(githubTokenRequest(requestStatePath, nextGithubToken));
      commitRuntimeState(response.state);
      setRemoteDraft(configToDraft(response.config));
      setRemoteStatus('远端配置已加载。API Key 直接显示；保存前请确认表单就是最终写入值。');
      setNotice({ tone: 'success', title: '远端配置已加载', copy: '你可以直接修改 provider、model、Base URL，或填写新的 API Key。' });
    } catch (error) {
      setNotice({ tone: 'error', title: '加载远端配置失败', copy: formatError(error) });
    } finally {
      setIsLoadingRemote(false);
    }
  }

  async function handleSaveRemoteConfig(): Promise<void> {
    const nextGithubToken = githubToken.trim();
    if (remoteDraft.apiKey.value.trim() === '') {
      setNotice({ tone: 'error', title: '需要 API Key', copy: '请填写最终要写入 agentcfg.yaml 的 API Key；Web 页面不再隐藏或沿用不可见密钥。' });
      return;
    }

    setIsSavingRemote(true);
    setNotice(null);
    try {
      const response = await saveRemoteConfigRuntime({ ...githubTokenRequest(requestStatePath, nextGithubToken), config: remoteDraft });
      commitRuntimeState(response.state);
      setGistId(response.state.gist.id ?? gistId);
      setRemoteDraft(configToDraft(response.config));
      setRemoteStatus('远端配置已保存。表单和预览已回填最终写入的完整值。');
      setDiffResponse(null);
      setPlanResponse(null);
      setPlanKey(null);
      setApplyResults(null);
      setNotice({ tone: 'success', title: '远端配置已保存', copy: 'agentcfg.yaml 已写入 Gist，并更新了本地缓存。' });
    } catch (error) {
      setNotice({ tone: 'error', title: '保存远端配置失败', copy: formatError(error) });
    } finally {
      setIsSavingRemote(false);
    }
  }

  async function handleClearSavedGitHubToken(): Promise<void> {
    setIsClearingGitHubToken(true);
    setNotice(null);
    try {
      const { state } = await clearSavedGitHubTokenRuntime({ statePath: requestStatePath });
      commitRuntimeState(state);
      setGithubToken('');
      setRememberGitHubToken(false);
      setIsEditingGitHubToken(false);
      setNotice({ tone: 'success', title: '已清除本地 Token', copy: 'secrets.json 中保存的 GitHub Token 已删除；后续远端操作需要重新输入 Token。' });
    } catch (error) {
      setNotice({ tone: 'error', title: '清除 Token 失败', copy: formatError(error) });
    } finally {
      setIsClearingGitHubToken(false);
    }
  }

  function githubTokenRequest(nextStatePath = requestStatePath, nextGithubToken = githubToken.trim()) {
    return {
      statePath: nextStatePath,
      githubToken: nextGithubToken,
      ...(shouldRememberGitHubToken && nextGithubToken !== '' ? { rememberGitHubToken: true } : {}),
    };
  }

  function handleEditSavedGitHubToken(): void {
    setGithubToken('');
    setRememberGitHubToken(false);
    setIsEditingGitHubToken(true);
  }

  function handleCancelGitHubTokenEdit(): void {
    setGithubToken('');
    setRememberGitHubToken(false);
    setIsEditingGitHubToken(false);
  }

  function updateRemoteDraft(field: ManagedField, value: string): void {
    setRemoteDraft((currentDraft) => {
      if (field === 'apiKey') {
        return { ...currentDraft, apiKey: { type: 'plain', value } };
      }
      return { ...currentDraft, [field]: value };
    });
  }

  async function handleDiff(): Promise<void> {
    if (targetRequest === null) {
      setNotice({ tone: 'error', title: '请选择目标', copy: '运行 diff 前请选择 Codex、OpenCode、OpenClaw 或全部代理。' });
      return;
    }

    setIsDiffing(true);
    setNotice(null);
    setApplyResults(null);
    try {
      setDiffResponse(await diffRuntime(targetRequest));
      setPlanResponse(null);
      setPlanKey(null);
      setNotice({ tone: 'success', title: 'Diff 已就绪', copy: '托管字段已按代理分组，API Key 按真实值显示。' });
    } catch (error) {
      setDiffResponse(null);
      setPlanResponse(null);
      setPlanKey(null);
      setNotice({ tone: 'error', title: 'Diff 需要处理', copy: formatError(error) });
    } finally {
      setIsDiffing(false);
    }
  }

  async function handlePlan(): Promise<void> {
    if (targetRequest === null) {
      setNotice({ tone: 'error', title: '请选择目标', copy: '规划写入前请只选择一个目标模式。' });
      return;
    }

    setIsPlanning(true);
    setNotice(null);
    setApplyResults(null);
    try {
      const response = await planApplyRuntime(targetRequest);
      setPlanResponse(response);
      setPlanKey(reviewKey);
      setNotice({ tone: 'success', title: 'Dry-run 完成', copy: '检查操作路径，然后输入 APPLY 解锁写入。' });
    } catch (error) {
      setPlanResponse(null);
      setPlanKey(null);
      setNotice({ tone: 'error', title: 'Dry-run 失败', copy: formatError(error) });
      const results = extractApplyResults(error);
      setApplyResults(results ?? null);
    } finally {
      setIsPlanning(false);
    }
  }

  async function handleApply(): Promise<void> {
    if (!canApply || targetRequest === null) {
      return;
    }

    setIsApplying(true);
    setNotice(null);
    try {
      const response = await applyRuntime({ ...targetRequest, confirm: 'APPLY' });
      setApplyResults(response.results);
      setConfirmationText('');
      await refreshState(requestStatePath);
      setNotice({ tone: 'success', title: '应用完成', copy: '所选代理文件已更新，控制台状态已刷新。' });
    } catch (error) {
      const results = extractApplyResults(error);
      setApplyResults(results ?? null);
      setNotice({ tone: 'error', title: '应用失败', copy: formatError(error) });
    } finally {
      setIsApplying(false);
    }
  }

  async function handleLoadConfigFile(): Promise<void> {
    if (configAgent === null) {
      setConfigStatus('请选择单个代理后再加载配置文件。');
      return;
    }

    setIsLoadingConfig(true);
    setNotice(null);
    try {
      const response = await getConfigFileRuntime({
        statePath: requestStatePath,
        agent: configAgent,
        configPath: configPath.trim(),
      });
      setConfigFile(response);
      setConfigDraft(response.content);
      setConfigStatus('配置已加载');
    } catch (error) {
      setConfigFile(null);
      setConfigDraft('');
      setConfigStatus(formatError(error));
      setNotice({ tone: 'error', title: '配置加载失败', copy: formatError(error) });
    } finally {
      setIsLoadingConfig(false);
    }
  }

  async function handleSaveConfigFile(): Promise<void> {
    if (configAgent === null || configFile === null) {
      return;
    }

    setIsSavingConfig(true);
    setNotice(null);
    try {
      const response = await saveConfigFileRuntime({
        statePath: requestStatePath,
        agent: configAgent,
        configPath: configFile.path,
        content: configDraft,
      });
      setConfigFile(response);
      setConfigDraft(response.content);
      setConfigStatus(response.backupPath === undefined ? '配置已保存' : `配置已保存，备份：${response.backupPath}`);
      setDiffResponse(null);
      setPlanResponse(null);
      setPlanKey(null);
      setApplyResults(null);
      setConfirmationText('');
    } catch (error) {
      setConfigStatus(formatError(error));
      setNotice({ tone: 'error', title: '配置保存失败', copy: formatError(error) });
    } finally {
      setIsSavingConfig(false);
    }
  }

  const noticeNode = notice && (
    <section className={`notice notice--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      <strong>{notice.title}</strong>
      <span>{notice.copy}</span>
    </section>
  );

  const loadErrorNode = loadState === 'error' && (
    <section className="empty-state" role="status">
      <p className="eyebrow">状态不可用</p>
      <h2>检查本地服务后重新加载控制台。</h2>
      <p>设置表单仍可使用，但控制台更新前需要 `/api/state` 正常响应。</p>
    </section>
  );

  return (
    <main className="app-shell" aria-labelledby="page-title">
        <header className="app-header">
          <div className="app-title-area">
            <p className="eyebrow">本地控制台</p>
            <h1 id="page-title">agentcfg</h1>
            <span>{statusLabel(runtimeState)}</span>
          </div>

          <nav className="tab-bar" role="tablist" aria-label="功能切换">
            <TabButton id="connection-tab" active={activeTab === 'connection'} controls="connection-panel" onClick={() => setActiveTab('connection')}>连接状态</TabButton>
            <TabButton id="execute-tab" active={activeTab === 'execute'} controls="execute-panel" onClick={() => setActiveTab('execute')}>执行变更</TabButton>
            <TabButton id="remote-tab" active={activeTab === 'remote'} controls="remote-panel" onClick={() => setActiveTab('remote')}>远端配置</TabButton>
            <TabButton id="config-tab" active={activeTab === 'config'} controls="config-panel" onClick={() => setActiveTab('config')}>配置文件</TabButton>
            <TabButton id="status-tab" active={activeTab === 'status'} controls="status-panel" onClick={() => setActiveTab('status')}>状态</TabButton>
          </nav>

          <div className="header-actions" aria-label="状态与同步操作">
            <StatusBadge tone={statusTone(runtimeState)}>
              {loadState === 'loading' ? '正在加载会话' : statusLabel(runtimeState)}
            </StatusBadge>
            <button className="primary-action primary-action--compact" type="button" onClick={handlePull} disabled={isBusy}>
              <span aria-hidden="true">+</span>
              {isPulling ? '正在拉取...' : '拉取远端'}
            </button>
          </div>
        </header>

        <section className="tab-viewport">
          {activeTab === 'connection' && (
            <section className="dashboard-grid dashboard-grid--connection" id="connection-panel" role="tabpanel" aria-labelledby="connection-tab">
              {noticeNode}
              {loadErrorNode}
              <article className="card onboarding-card connection-card" id="setup-panel">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">初始化</p>
                    <h2>连接状态</h2>
                  </div>
                  <StatusBadge tone={runtimeState?.gist.present ? 'ready' : 'pending'}>
                    {runtimeState?.gist.present ? '状态已连接' : '等待连接'}
                  </StatusBadge>
                </div>
                <form className="setup-form" onSubmit={handleInitSubmit}>
                  <label htmlFor="github-token">
                    GitHub Token
                    <input
                      id="github-token"
                      name="github-token"
                      type="password"
                      value={githubTokenInputValue}
                      onChange={(event) => setGithubToken(event.target.value)}
                      placeholder={isGitHubTokenLocked ? SAVED_GITHUB_TOKEN_MASK : '粘贴带 gist 权限的 token'}
                      autoComplete="off"
                      disabled={isGitHubTokenLocked || isSubmittingInit || isSettingRemote}
                    />
                  </label>
                  <label htmlFor="gist-id">
                    Gist ID（高级兼容，可选）
                    <input
                      id="gist-id"
                      name="gist-id"
                      value={gistId}
                      onChange={(event) => setGistId(event.target.value)}
                      placeholder="私有 Gist ID"
                      autoComplete="off"
                      disabled={isSubmittingInit}
                    />
                  </label>
                  <label htmlFor="state-path">
                    状态路径（可选）
                    <input
                      id="state-path"
                      name="state-path"
                      value={statePath}
                      onChange={(event) => setStatePath(event.target.value)}
                      placeholder={runtimeState?.statePath ?? '~/.agentcfg/state.json'}
                      autoComplete="off"
                      disabled={isSubmittingInit}
                    />
                  </label>
                  <label className="checkbox-control" htmlFor="remember-github-token">
                    <input
                      id="remember-github-token"
                      name="remember-github-token"
                      type="checkbox"
                      checked={isReplacingSavedGitHubToken ? githubToken.trim() !== '' : rememberGitHubToken}
                      onChange={(event) => setRememberGitHubToken(event.target.checked)}
                      disabled={isGitHubTokenLocked || isReplacingSavedGitHubToken || isSubmittingInit || isSettingRemote || githubToken.trim() === ''}
                    />
                    <span>{isReplacingSavedGitHubToken ? '替换保存的 Token（自动保存）' : '本地明文保存 Token'}</span>
                  </label>
                  <div className="saved-token-control" role="status" aria-live="polite">
                    <span>{hasSavedGitHubToken ? (isEditingGitHubToken ? '正在替换已保存 GitHub Token，输入新 Token 后会自动保存。' : '已保存 GitHub Token，输入框已锁定为固定掩码。') : '尚未保存 GitHub Token。'}</span>
                    <div className="saved-token-actions" aria-label="保存的 GitHub Token 操作">
                      {hasSavedGitHubToken && !isEditingGitHubToken && (
                        <button className="secondary-action secondary-action--compact" type="button" onClick={handleEditSavedGitHubToken} disabled={isBusy}>
                          编辑保存的 Token
                        </button>
                      )}
                      {hasSavedGitHubToken && isEditingGitHubToken && (
                        <button className="secondary-action secondary-action--compact" type="button" onClick={handleCancelGitHubTokenEdit} disabled={isBusy}>
                          取消编辑
                        </button>
                      )}
                      <button
                        className="secondary-action secondary-action--compact"
                        type="button"
                        onClick={handleClearSavedGitHubToken}
                        disabled={!hasSavedGitHubToken || isClearingGitHubToken}
                      >
                        {isClearingGitHubToken ? '正在清除...' : '清除保存的 Token'}
                      </button>
                    </div>
                  </div>
                  <button className="primary-action" type="submit" disabled={isSubmittingInit || isSettingRemote}>
                    {isSettingRemote ? '正在连接...' : isSubmittingInit ? '正在保存...' : '连接 GitHub'}
                  </button>
                </form>
                <p className="helper-copy">勾选后 Token 会以明文保存到本机 secrets.json；API 只返回是否已保存，不会把 Token 值发回界面。若没有现有 agentcfg Gist，在“远端配置”保存时会自动创建 secret Gist。</p>
                <div className="step-list" aria-label="设置进度">
                  {setupSteps.map((step) => (
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
                  <span className={`status-dot status-dot--${statusTone(runtimeState)}`} aria-hidden="true" />
                </div>
                <dl className="detail-list">
                  <Detail label="状态路径" value={runtimeState?.statePath ?? '正在解析本地状态...'} />
                  <Detail label="来源" value={runtimeState?.gist.present ? `Gist ${runtimeState.gist.id}` : '未初始化'} />
                  <Detail label="安全" value={runtimeState?.conflict.present ? '需要检查冲突' : '未标记冲突'} />
                </dl>
              </article>
            </section>
          )}

          {activeTab === 'remote' && (
            <section className="dashboard-grid" id="remote-panel" role="tabpanel" aria-labelledby="remote-tab">
              {noticeNode}
              {loadErrorNode}
              <article className="card remote-editor-card">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">远端配置</p>
                    <h2>用表单生成并保存 agentcfg.yaml，不需要手写 Gist 内容。</h2>
                  </div>
                  <StatusBadge tone={runtimeState?.gist.present ? 'ready' : 'pending'}>{runtimeState?.gist.present ? '已绑定 Gist' : '保存时创建'}</StatusBadge>
                </div>
                <div className="config-editor-meta" role="status" aria-live="polite">
                  <span>{remoteStatus}</span>
                  <strong>{runtimeState?.gist.id ?? '尚未绑定 Gist'}</strong>
                </div>
                <div className="remote-config-layout">
                  <form className="remote-config-form" onSubmit={(event) => { event.preventDefault(); void handleSaveRemoteConfig(); }}>
                    <label htmlFor="remote-provider">
                      Provider
                      <input id="remote-provider" value={remoteDraft.provider} onChange={(event) => updateRemoteDraft('provider', event.target.value)} autoComplete="off" disabled={isSavingRemote} />
                    </label>
                    <label htmlFor="remote-model">
                      Model
                      <input id="remote-model" value={remoteDraft.model} onChange={(event) => updateRemoteDraft('model', event.target.value)} autoComplete="off" disabled={isSavingRemote} />
                    </label>
                    <label htmlFor="remote-base-url">
                      Base URL
                      <input id="remote-base-url" value={remoteDraft.baseURL} onChange={(event) => updateRemoteDraft('baseURL', event.target.value)} autoComplete="off" disabled={isSavingRemote} />
                    </label>
                    <label htmlFor="remote-api-key">
                      API Key
                      <input id="remote-api-key" type="text" value={remoteDraft.apiKey.value} onChange={(event) => updateRemoteDraft('apiKey', event.target.value)} placeholder="最终写入 agentcfg.yaml 的 API Key" autoComplete="off" disabled={isSavingRemote} />
                    </label>
                    <div className="remote-actions">
                      <button className="secondary-action" type="button" onClick={handleLoadRemoteConfig} disabled={isLoadingRemote || isSavingRemote}>
                        {isLoadingRemote ? '正在加载...' : '加载远端配置'}
                      </button>
                      <button className="primary-action" type="submit" disabled={isSavingRemote}>
                        {isSavingRemote ? '正在保存...' : '保存远端配置'}
                      </button>
                    </div>
                  </form>
                  <aside className="remote-preview-stack" aria-label="agentcfg.yaml 预览">
                    <section className="remote-preview-card">
                      <div className="remote-preview-heading">
                        <p className="eyebrow">原始预览</p>
                        <h3>生成的 agentcfg.yaml</h3>
                      </div>
                      <pre id="remote-yaml-preview" className="remote-preview-block" aria-label="生成的 agentcfg.yaml"><code>{remoteYamlPreview}</code></pre>
                    </section>
                    <section className="remote-preview-card">
                      <div className="remote-preview-heading">
                        <p className="eyebrow">Schema 参考</p>
                        <h3>当前字段说明</h3>
                      </div>
                      <SchemaReference />
                    </section>
                  </aside>
                </div>
              </article>
            </section>
          )}

          {activeTab === 'config' && (
            <section className="dashboard-grid dashboard-grid--config" id="config-panel" role="tabpanel" aria-labelledby="config-tab">
              {noticeNode}
              {loadErrorNode}
              <article className="card config-editor-card">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">配置文件</p>
                    <h2>直接查看、编辑并保存当前代理的原生配置文件。</h2>
                  </div>
                  <StatusBadge tone={configFile === null ? 'pending' : configDraft === configFile.content ? 'ready' : 'warning'}>
                    {configFile === null ? '未加载' : configDraft === configFile.content ? '已同步' : '有未保存修改'}
                  </StatusBadge>
                </div>
                <div className="config-editor-toolbar">
                  <fieldset className="target-grid raw-config-target-grid">
                    <legend>选择要查看的配置文件</legend>
                    {CONFIG_TARGET_OPTIONS.map((target) => (
                      <label className="target-option" key={target.value}>
                        <input
                          type="radio"
                          name="config-target-mode"
                          value={target.value}
                          checked={targetMode === target.value}
                          onChange={() => setTargetMode(target.value)}
                        />
                        <span>
                          <strong>{target.title}</strong>
                          <small>{target.copy}</small>
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="path-form">
                    <label htmlFor="config-path-editor">
                      配置路径覆盖
                      <input
                        id="config-path-editor"
                        value={configPath}
                        onChange={(event) => setConfigPath(event.target.value)}
                        placeholder="单个配置文件、配置目录，或留空使用默认值"
                        autoComplete="off"
                      />
                    </label>
                    <div className="path-note">
                      <span>当前目标</span>
                      <strong>{configAgent === null ? '请选择单个代理' : agentLabel(configAgent)}</strong>
                    </div>
                    <div className="review-actions" aria-label="配置文件操作">
                      <button className="secondary-action" type="button" onClick={handleLoadConfigFile} disabled={!canLoadConfig}>
                        {isLoadingConfig ? '正在加载...' : '加载配置'}
                      </button>
                      <button className="primary-action" type="button" onClick={handleSaveConfigFile} disabled={!canSaveConfig}>
                        {isSavingConfig ? '正在保存...' : '保存配置'}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="config-editor-meta" role="status" aria-live="polite">
                  <span>{configStatus}</span>
                  {configFile !== null && <strong>{configFile.path}</strong>}
                </div>
                <div className="config-editor-body">
                  <textarea
                    id="config-editor"
                    className="config-editor-textarea"
                    value={configDraft}
                    onChange={(event) => setConfigDraft(event.target.value)}
                    placeholder="加载配置后可在此编辑原始文件内容。"
                    spellCheck={false}
                    wrap="off"
                  />
                </div>
              </article>
            </section>
          )}

          {activeTab === 'execute' && (
            <section className="dashboard-grid" id="execute-panel" role="tabpanel" aria-labelledby="execute-tab">
              {noticeNode}
              {loadErrorNode}
              <article className="card diff-card execute-card" id="review-panel">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">审阅与应用</p>
                    <h2>Diff、dry-run、再输入确认应用</h2>
                  </div>
                  <StatusBadge tone={isPlanCurrent ? 'ready' : targetMode === '' ? 'pending' : 'warning'}>
                    {isPlanCurrent ? 'Dry-run 已就绪' : targetMode === '' ? '选择目标' : '需要 dry-run'}
                  </StatusBadge>
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
                            checked={targetMode === target.value}
                            onChange={() => setTargetMode(target.value)}
                          />
                          <span>
                            <strong>{target.title}</strong>
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
                          value={configPath}
                          onChange={(event) => setConfigPath(event.target.value)}
                          placeholder="单个配置文件、配置目录，或留空使用默认值"
                          autoComplete="off"
                        />
                      </label>
                      <div className="path-note">
                        <span>实际状态路径</span>
                        <strong>{requestStatePath ?? '默认本地状态'}</strong>
                      </div>
                    </div>

                    <div className="review-actions" aria-label="Diff 与应用操作">
                      <button className="secondary-action" type="button" onClick={handleDiff} disabled={!canReview}>
                        {isDiffing ? '正在 diff...' : '运行 diff'}
                      </button>
                      <button className="secondary-action" type="button" onClick={handlePlan} disabled={!canReview}>
                        {isPlanning ? '正在规划...' : '执行 dry-run'}
                      </button>
                    </div>

                    <div className="apply-lock" aria-label="应用安全门禁">
                      <div>
                        <p className="eyebrow">强确认门禁</p>
                        <h3>成功 dry-run 后输入 APPLY。</h3>
                        <p>只有所选目标与路径匹配最新计划后，应用才会解锁。</p>
                      </div>
                      <label htmlFor="apply-confirmation">
                        确认文本
                        <input
                          id="apply-confirmation"
                          value={confirmationText}
                          onChange={(event) => setConfirmationText(event.target.value)}
                          placeholder="APPLY"
                          autoComplete="off"
                          disabled={!isPlanCurrent || isApplying}
                        />
                      </label>
                      <button className="primary-action" type="button" onClick={handleApply} disabled={!canApply}>
                        {isApplying ? '正在应用...' : '应用所选目标'}
                      </button>
                    </div>
                  </section>

                  <section className="review-results" aria-label="Diff、dry-run 与应用结果">
                    <DiffResults results={diffResponse?.results ?? null} />
                    <PlanResults plans={planResponse?.plans ?? null} results={planResponse?.results ?? null} stale={planResponse !== null && !isPlanCurrent} />
                    <ApplyResults results={applyResults} />
                  </section>
                </div>
              </article>
            </section>
          )}

          {activeTab === 'status' && (
            <section className="dashboard-grid" id="status-panel" role="tabpanel" aria-labelledby="status-tab">
              {noticeNode}
              {loadErrorNode}
              <article className="card source-card">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">来源</p>
                    <h2>Gist 与缓存</h2>
                  </div>
                  <StatusBadge tone={runtimeState?.gist.present ? 'ready' : 'pending'}>
                    {runtimeState?.gist.present ? '已连接' : '需要设置'}
                  </StatusBadge>
                </div>
                <dl className="detail-list">
                  <Detail label="Gist 状态" value={runtimeState?.gist.present ? '已存在' : '缺失'} />
                  <Detail label="Gist ID" value={runtimeState?.gist.id ?? '未设置'} />
                  <Detail label="缓存状态" value={runtimeState?.cache.present ? '已缓存' : '为空'} />
                  <Detail label="缓存更新时间" value={formatDate(runtimeState?.cache.updatedAt)} />
                </dl>
              </article>
              <article className="card remote-card">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">远端</p>
                    <h2>版本元数据</h2>
                  </div>
                  <StatusBadge tone={runtimeState?.remote ? 'ready' : 'pending'}>{runtimeState?.remote ? '已同步' : '尚未拉取'}</StatusBadge>
                </div>
                {runtimeState?.remote ? (
                  <dl className="detail-list">
                    <Detail label="Revision" value={runtimeState.remote.revision ?? '未返回'} />
                    <Detail label="ETag" value={runtimeState.remote.etag ?? '未返回'} />
                    <Detail label="拉取时间" value={formatDate(runtimeState.remote.pulledAt)} />
                  </dl>
                ) : (
                  <EmptyCopy title="远端元数据为空" copy="初始化 Gist 后拉取，即可记录 Revision 与缓存时间戳。" />
                )}
              </article>
              <article className="card config-card">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">缓存</p>
                    <h2>完整配置摘要</h2>
                  </div>
                  <StatusBadge tone={runtimeState?.cache.config ? 'ready' : 'pending'}>{runtimeState?.cache.config ? '显示完整值' : '为空'}</StatusBadge>
                </div>
                {runtimeState?.cache.config ? <ConfigSummary config={runtimeState.cache.config} /> : <EmptyCopy title="暂无缓存配置" copy="从已连接的 Gist 拉取后，可在此预览完整运行时值。" />}
              </article>
              <article className="card conflict-card">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">冲突</p>
                    <h2>安全指示器</h2>
                  </div>
                  <StatusBadge tone={runtimeState?.conflict.present ? 'warning' : 'ready'}>
                    {runtimeState?.conflict.present ? '待审阅' : '清晰'}
                  </StatusBadge>
                </div>
                <dl className="detail-list">
                  <Detail label="冲突状态" value={runtimeState?.conflict.present ? '已存储远端基线' : '当前无冲突'} />
                  <Detail label="Base revision" value={runtimeState?.conflict.baseRevision ?? '无'} />
                  <Detail label="Base ETag" value={runtimeState?.conflict.baseETag ?? '无'} />
                </dl>
              </article>
            </section>
          )}
        </section>
    </main>
  );
}

function TabButton({ active, children, controls, id, onClick }: { active: boolean; children: string; controls: string; id: string; onClick: () => void }) {
  return (
    <button id={id} className={`tab-button ${active ? 'tab-button--active' : ''}`} type="button" role="tab" aria-selected={active} aria-controls={controls} tabIndex={active ? 0 : -1} onClick={onClick}>
      {children}
    </button>
  );
}

function StatusBadge({ children, tone }: { children: string; tone: 'ready' | 'pending' | 'warning' }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function EmptyCopy({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="mini-empty">
      <h3>{title}</h3>
      <p>{copy}</p>
    </div>
  );
}

function ConfigSummary({ config }: { config: AgentConfig }) {
  return (
    <dl className="detail-list config-summary">
      <Detail label="提供方" value={config.provider} />
      <Detail label="模型" value={config.model} />
      <Detail label="Base URL" value={config.baseURL} />
      <Detail label="API 密钥" value={config.apiKey.value} />
    </dl>
  );
}

function DiffResults({ results }: { results: AgentDiffResult[] | null }) {
  if (results === null) {
    return <EmptyCopy title="尚未运行 diff" copy="选择目标后运行 diff，以比较托管字段。" />;
  }

  return (
    <section className="result-stack" aria-label="Diff 结果">
      <ResultHeading eyebrow="Diff" title="托管字段变更" />
      {results.map((result) => (
        <AgentChangeCard key={result.agent} title={agentLabel(result.agent)} subtitle="当前原生值 -> 预期缓存值" changes={result.changes} />
      ))}
    </section>
  );
}

function PlanResults({ plans, results, stale }: { plans: ApplyPlanSummary[] | null; results: ApplyAgentResult[] | null; stale: boolean }) {
  if (plans === null || results === null) {
    return <EmptyCopy title="需要 dry-run" copy="应用按钮解锁前必须先获得成功计划。" />;
  }

  return (
    <section className="result-stack" aria-label="Dry-run 计划结果">
      <ResultHeading eyebrow="Dry-run 计划" title={stale ? '路径编辑后计划已过期' : '操作摘要'} />
      {plans.map((plan) => (
        <article className="agent-result-card" key={plan.agent}>
          <div className="agent-result-card__header">
            <h3>{agentLabel(plan.agent)}</h3>
            <StatusBadge tone={stale ? 'warning' : plan.operationCount > 0 ? 'warning' : 'ready'}>
              {`${plan.operationCount} 项操作`}
            </StatusBadge>
          </div>
          <dl className="detail-list compact-detail-list">
            <Detail label="原生配置" value={plan.configPath} />
            {plan.envPath !== undefined && <Detail label="Env 文件" value={plan.envPath} />}
            <Detail label="状态" value={formatStatus(results.find((result) => result.agent === plan.agent)?.status)} />
          </dl>
          <PathList title="操作路径" paths={plan.operationPaths} empty="不会更改任何文件。" />
          <FilePreviewList previews={plan.filePreviews} />
          <FieldRows changes={plan.changes} />
        </article>
      ))}
    </section>
  );
}

function ApplyResults({ results }: { results: ApplyAgentResult[] | null }) {
  if (results === null) {
    return <EmptyCopy title="暂无应用结果" copy="确认写入后，已应用、失败与备份路径会显示在这里。" />;
  }

  return (
    <section className="result-stack" aria-label="应用结果">
      <ResultHeading eyebrow="应用" title="写入结果" />
      {results.map((result) => (
        <article className="agent-result-card" key={result.agent}>
          <div className="agent-result-card__header">
            <h3>{agentLabel(result.agent)}</h3>
            <StatusBadge tone={result.status === 'applied' || result.status === 'unchanged' ? 'ready' : 'warning'}>{formatStatus(result.status)}</StatusBadge>
          </div>
          <dl className="detail-list compact-detail-list">
            {result.configPath !== undefined && <Detail label="原生配置" value={result.configPath} />}
            {result.envPath !== undefined && <Detail label="Env 文件" value={result.envPath} />}
            {result.error !== undefined && <Detail label="错误" value={result.error} />}
          </dl>
          <PathList title="备份路径" paths={result.backups} empty="未返回备份。" />
          <FieldRows changes={result.changes} />
        </article>
      ))}
    </section>
  );
}

function ResultHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="result-heading">
      <p className="eyebrow">{eyebrow}</p>
      <h3>{title}</h3>
    </div>
  );
}

function AgentChangeCard({ title, subtitle, changes }: { title: string; subtitle: string; changes: ManagedDiffChange[] }) {
  return (
    <article className="agent-result-card">
      <div className="agent-result-card__header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <StatusBadge tone={changes.length > 0 ? 'warning' : 'ready'}>{changes.length > 0 ? '有变更' : '未变化'}</StatusBadge>
      </div>
      <FieldRows changes={changes} />
    </article>
  );
}

function FieldRows({ changes }: { changes: ManagedDiffChange[] }) {
  return (
    <div className="field-grid">
      {MANAGED_FIELDS.map((field) => {
        const change = changes.find((candidate) => candidate.field === field);
        return (
          <div className={`field-row ${change === undefined ? 'field-row--same' : 'field-row--change'}`} key={field}>
            <span className="field-name">{fieldLabel(field)}</span>
            <span>{formatManagedValue(change, 'current')}</span>
            <span>{formatManagedValue(change, 'expected')}</span>
          </div>
        );
      })}
    </div>
  );
}

function PathList({ title, paths, empty }: { title: string; paths: string[]; empty: string }) {
  return (
    <div className="path-list">
      <strong>{title}</strong>
      {paths.length === 0 ? (
        <p>{empty}</p>
      ) : (
        <ul>
          {paths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilePreviewList({ previews }: { previews: ApplyFilePreview[] }) {
  if (previews.length === 0) {
    return <EmptyCopy title="文件预览无变化" copy="本次 dry-run 不会改写任何文件。" />;
  }

  return (
    <div className="file-preview-list" aria-label="当前与应用后文件内容预览">
      {previews.map((preview) => (
        <article className="file-preview-card" key={`${preview.kind}:${preview.path}`}>
          <div className="file-preview-card__header">
            <div>
              <p className="eyebrow">{preview.kind === 'env' ? 'Env 文件' : '原生配置'}</p>
              <h4>{preview.path}</h4>
            </div>
            {preview.mode !== undefined && <span>{formatFileMode(preview.mode)}</span>}
          </div>
          <FileDiffViewer path={preview.path} currentContent={preview.currentContent ?? ''} expectedContent={preview.expectedContent} />
        </article>
      ))}
    </div>
  );
}

function SchemaReference() {
  return (
    <section id="remote-schema-preview" className="schema-docs" aria-label="agentcfg.yaml schema 参考">
      <p className="schema-docs__intro">agentcfg.yaml canonical fields. This reference documents the schema only and never mirrors current form values.</p>
      <dl className="schema-docs__list">
        {AGENTCFG_SCHEMA_DOCS.map((field) => (
          <div className="schema-docs__field" key={field.path}>
            <dt>
              <code>{field.path}</code>
              <span>{field.required ? 'required' : 'optional'}</span>
            </dt>
            <dd>
              <strong>{field.label}</strong>
              <span>Type: {field.type}</span>
              <p>{field.description}</p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function buildSetupSteps(state: RuntimeStateSummary | null): Step[] {
  return [
    {
      title: '连接状态',
      copy: state?.gist.present ? '此本地会话已知道要使用的私有 Gist。' : '保存 CLI 使用的私有 Gist ID。',
      state: state?.gist.present ? 'ready' : 'pending',
    },
    {
      title: '拉取缓存',
      copy: state?.cache.present ? '远端配置已在本地缓存，并显示为完整值。' : '从 Gist 拉取以填充控制台缓存。',
      state: state?.cache.present ? 'ready' : 'pending',
    },
    {
      title: '审阅变更',
      copy: state?.cache.present ? '选择目标后即可执行 diff、dry-run 与应用。' : '拉取缓存后才会解锁审阅。',
      state: state?.cache.present ? 'pending' : 'locked',
    },
  ];
}

function statusTone(state: RuntimeStateSummary | null): 'ready' | 'pending' | 'warning' {
  if (state?.conflict.present) {
    return 'warning';
  }
  if (state?.cache.present) {
    return 'ready';
  }
  return 'pending';
}

function statusLabel(state: RuntimeStateSummary | null): string {
  if (state?.conflict.present) {
    return '需要检查冲突';
  }
  if (state?.cache.present) {
    return '缓存已就绪';
  }
  if (state?.gist.present) {
    return '可以拉取';
  }
  return '需要设置';
}

function formatDate(value: string | undefined): string {
  if (value === undefined) {
    return '不可用';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function configToDraft(config: AgentConfig): EditableAgentConfig {
  return {
    schemaVersion: config.schemaVersion,
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL,
    apiKey: {
      type: 'plain',
      value: config.apiKey.value,
    },
  };
}

function buildRemoteYamlPreview(config: EditableAgentConfig): string {
  return [
    `schemaVersion: ${config.schemaVersion}`,
    `provider: ${yamlScalar(config.provider)}`,
    `model: ${yamlScalar(config.model)}`,
    `baseURL: ${yamlScalar(config.baseURL)}`,
    'apiKey:',
    `  type: ${yamlScalar(config.apiKey.type)}`,
    `  value: ${yamlScalar(config.apiKey.value)}`,
    '',
  ].join('\n');
}

function yamlScalar(value: string): string {
  if (value === '') {
    return '""';
  }
  return JSON.stringify(value);
}

function formatError(error: unknown): string {
  if (error instanceof RuntimeClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '发生意外运行时错误。';
}

function formatManagedValue(change: ManagedDiffChange | undefined, side: 'current' | 'expected'): string {
  if (change === undefined) {
    return '无变化';
  }
  const value = side === 'current' ? change.current : change.expected;
  return value ?? '未设置';
}

function formatStatus(status: ApplyAgentResult['status'] | undefined): string {
  if (status === undefined) {
    return '未返回';
  }
  if (status === 'would-change') {
    return '将会变更';
  }
  if (status === 'applied') {
    return '已应用';
  }
  if (status === 'unchanged') {
    return '无变化';
  }
  if (status === 'failed') {
    return '失败';
  }
  if (status === 'cancelled') {
    return '已取消';
  }
  return status;
}

function formatFileMode(mode: number): string {
  return `mode ${mode.toString(8).padStart(4, '0')}`;
}

function fieldLabel(field: ManagedField): string {
  if (field === 'baseURL') {
    return 'Base URL';
  }
  if (field === 'apiKey') {
    return 'API 密钥';
  }
  if (field === 'provider') {
    return '提供方';
  }
  if (field === 'model') {
    return '模型';
  }
  return field;
}

function agentLabel(agent: AgentName): string {
  if (agent === 'opencode') {
    return 'OpenCode';
  }
  if (agent === 'openclaw') {
    return 'OpenClaw';
  }
  return 'Codex';
}

function extractApplyResults(error: unknown): ApplyAgentResult[] | undefined {
  if (!(error instanceof RuntimeClientError) || !isRecord(error.details)) {
    return undefined;
  }
  const results = error.details.results;
  return Array.isArray(results) ? (results as ApplyAgentResult[]) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export default App;
