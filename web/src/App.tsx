import { type SyntheticEvent, useEffect, useMemo, useState } from 'react';
import { AGENTCFG_SCHEMA_DOCS, type AgentConfigSchemaDoc } from '../../src/core/schema-docs';
import { OH_MY_OPENAGENT_AGENT_NAMES, OH_MY_OPENAGENT_CATEGORY_NAMES, OH_MY_OPENAGENT_MODEL_VARIANTS } from '../../src/core/schema';
import { FileDiffViewer } from './FileDiffViewer';
import { RulesPanel } from './RulesPanel';
import { SyncPanel } from './SyncPanel';
import {
  type EditableAgentConfig,
  applyRuntime,
  clearSavedGitHubTokenRuntime,
  diffRuntime,
  getConfigAvailabilityRuntime,
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
  type ConfigAvailabilityEntry,
  type ConfigFileRuntimeResponse,
  type DiffRuntimeResponse,
  type ManagedDiffChange,
  type ManagedDiffNotice,
  type OhMyOpenAgentModelAssignment,
  type OhMyOpenAgentModelVariant,
  type PlanApplyRuntimeResponse,
  type RuntimeStateSummary,
  type RuntimeTargetRequest,
} from './api';
import {
  MANAGED_FIELDS,
  agentSupportsManagedFieldDiff,
  agentLabel,
  buildRemoteYamlPreview,
  buildSetupSteps,
  configToDraft,
  extractApplyResults,
  fieldLabel,
  formatDate,
  formatError,
  formatFileMode,
  formatManagedValue,
  formatStatus,
  localReviewActionCopyForAgent,
  remoteAccessWarningForHostname,
  statusLabel,
  statusTone,
  type Step,
} from './view-model';

type Notice = {
  tone: 'success' | 'error';
  title: string;
  copy: string;
};

type TargetMode = AgentName | 'all' | '';

type AppTab = 'connection' | 'remote' | 'config' | 'rules' | 'sync' | 'execute' | 'status';

type RemoteConfigView = 'editor' | 'preview';

type OhMyOpenAgentAssignmentKind = 'agents' | 'categories';

type SchemaDocTreeNode = {
  field: AgentConfigSchemaDoc;
  children: SchemaDocTreeNode[];
};

const TARGET_OPTIONS: Array<{ value: Exclude<TargetMode, ''>; title: string; copy: string }> = [
  { value: 'codex', title: 'Codex', copy: '检查 ~/.codex 设置与生成的 env 文件。' },
  { value: 'opencode', title: 'OpenCode', copy: '检查一个 OpenCode JSON 或 JSONC 配置。' },
  { value: 'openclaw', title: 'OpenClaw', copy: '检查一个 OpenClaw JSON 或 JSON5 配置。' },
  { value: 'claude', title: 'Claude Code', copy: '检查 Claude Code settings.json 配置。' },
  { value: 'ohmyopenagent', title: 'OhMyOpenAgent', copy: '检查 OhMyOpenAgent 模型路由配置。' },
  { value: 'all', title: '全部代理', copy: '同时处理 Codex、OpenCode、OpenClaw、Claude Code 与 OhMyOpenAgent。' },
];

const CONFIG_TARGET_OPTIONS: Array<{ value: AgentName; title: string; copy: string }> = [
  { value: 'codex', title: 'Codex', copy: '查看 Codex TOML 配置原文。' },
  { value: 'opencode', title: 'OpenCode', copy: '查看 OpenCode JSON/JSONC 配置原文。' },
  { value: 'openclaw', title: 'OpenClaw', copy: '查看 OpenClaw JSON/JSON5 配置原文。' },
  { value: 'claude', title: 'Claude Code', copy: '查看 Claude Code settings.json 配置原文。' },
  { value: 'ohmyopenagent', title: 'OhMyOpenAgent', copy: '查看 OhMyOpenAgent JSON 路由配置原文。' },
];

const EMPTY_REMOTE_CONFIG: EditableAgentConfig = {
  schemaVersion: 1,
  defaults: {
    provider: 'openai',
    model: 'gpt-4.1-mini',
  },
  providers: {
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: {
        type: 'plain',
        value: '',
      },
      models: {
        'gpt-4.1-mini': {},
      },
    },
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
  const [remoteEditorProviderId, setRemoteEditorProviderId] = useState(EMPTY_REMOTE_CONFIG.defaults.provider);
  const [remoteEditorModelId, setRemoteEditorModelId] = useState(EMPTY_REMOTE_CONFIG.defaults.model);
  const [remoteStatus, setRemoteStatus] = useState('输入 GitHub Token 后，应用会发现现有 agentcfg Gist；没有时会在保存远端配置时自动创建。');
  const [targetMode, setTargetMode] = useState<TargetMode>('');
  const [diffResponse, setDiffResponse] = useState<DiffRuntimeResponse | null>(null);
  const [planResponse, setPlanResponse] = useState<PlanApplyRuntimeResponse | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [applyResults, setApplyResults] = useState<ApplyAgentResult[] | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [activeTab, setActiveTab] = useState<AppTab>('connection');
  const [remoteConfigView, setRemoteConfigView] = useState<RemoteConfigView>('editor');
  const [configFile, setConfigFile] = useState<ConfigFileRuntimeResponse | null>(null);
  const [configAvailability, setConfigAvailability] = useState<ConfigAvailabilityEntry[]>([]);
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
  const [isLoadingConfigAvailability, setIsLoadingConfigAvailability] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  useEffect(() => {
    let active = true;

    getRuntimeState()
      .then(async ({ state }) => {
        if (!active) {
          return;
        }
        commitRuntimeState(state);
        setLoadState('ready');
        setGistId(state.gist.id ?? '');

        if (state.secrets?.hasGitHubToken === true && state.gist.present) {
          setIsLoadingRemote(true);
          try {
            const response = await loadRemoteConfigRuntime({ statePath: state.statePath });
            if (!active) {
              return;
            }
            commitRuntimeState(response.state);
            setGistId(response.state.gist.id ?? '');
            replaceRemoteDraft(configToDraft(response.config));
            setRemoteStatus('远端配置已自动刷新。表单显示的是当前 Gist 完整值；API Key 直接显示。');
          } catch (error) {
            if (!active) {
              return;
            }
            setRemoteStatus(`自动刷新远端配置失败：${formatError(error)}`);
          } finally {
            if (active) {
              setIsLoadingRemote(false);
            }
          }
        }
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
  const canReviewManagedDiff = canReview && (targetRequest?.agent === undefined || agentSupportsManagedFieldDiff(targetRequest.agent));
  const canApply = targetRequest !== null && isPlanCurrent && confirmationText === 'APPLY' && !isBusy;
  const configAgent = targetMode === '' || targetMode === 'all' ? null : targetMode;
  const canReviewLocalConfig = configAgent !== null && canReview;
  const canReviewLocalConfigManagedDiff = configAgent !== null && agentSupportsManagedFieldDiff(configAgent) && canReview;
  const canApplyLocalConfig = configAgent !== null && canApply;
  const canConfirmLocalConfig = configAgent !== null && isPlanCurrent && !isApplying;
  const showLocalConfigDiffButton = configAgent === null || agentSupportsManagedFieldDiff(configAgent);
  const showReviewDiffButton = targetMode === '' || targetMode === 'all' || (configAgent !== null && agentSupportsManagedFieldDiff(configAgent));
  const localSyncTargetLabel = configAgent === null ? '请选择单个本地配置目标' : `${agentLabel(configAgent)} / ${configPath.trim() === '' ? '默认检测路径' : configPath.trim()}`;
  const configBusy = isLoadingConfig || isSavingConfig;
  const configAvailabilityByAgent = useMemo(() => new Map(configAvailability.map((entry) => [entry.agent, entry])), [configAvailability]);
  const isConfigAgentAvailable = configAgent === null ? false : configAvailabilityByAgent.get(configAgent)?.available === true;
  const canLoadConfig = configAgent !== null && isConfigAgentAvailable && !configBusy;
  const canSaveConfig = configAgent !== null && configFile !== null && configDraft !== configFile.content && !configBusy;
  const isGitHubTokenLocked = hasSavedGitHubToken && !isEditingGitHubToken;
  const isReplacingSavedGitHubToken = hasSavedGitHubToken && isEditingGitHubToken;
  const githubTokenInputValue = isGitHubTokenLocked ? SAVED_GITHUB_TOKEN_MASK : githubToken;
  const shouldRememberGitHubToken = isReplacingSavedGitHubToken ? githubToken.trim() !== '' : rememberGitHubToken;
  const remoteYamlPreview = useMemo(() => buildRemoteYamlPreview(remoteDraft), [remoteDraft]);
  const remoteProviderIds = Object.keys(remoteDraft.providers);
  const selectedRemoteProviderId = remoteDraft.providers[remoteEditorProviderId] === undefined ? remoteProviderIds[0] ?? '' : remoteEditorProviderId;
  const selectedRemoteProvider = providerDraft(remoteDraft, selectedRemoteProviderId);
  const remoteModelIds = Object.keys(selectedRemoteProvider.models);
  const selectedRemoteModelId = selectedRemoteProvider.models[remoteEditorModelId] === undefined ? remoteModelIds[0] ?? '' : remoteEditorModelId;
  const selectedRemoteModel = modelDraft(selectedRemoteProvider, selectedRemoteModelId);
  const defaultProvider = remoteDraft.providers[remoteDraft.defaults.provider] === undefined ? selectedRemoteProviderId : remoteDraft.defaults.provider;
  const defaultProviderModelIds = Object.keys(providerDraft(remoteDraft, defaultProvider).models);
  const remoteModelReferenceOptions = useMemo(() => buildRemoteModelReferenceOptions(remoteDraft), [remoteDraft]);
  const remoteAccessWarning = useMemo(() => remoteAccessWarningForHostname(typeof window === 'undefined' ? undefined : window.location.hostname), []);

  useEffect(() => {
    setConfirmationText('');
  }, [reviewKey]);

  useEffect(() => {
    setConfigFile(null);
    setConfigDraft('');
    setConfigStatus(configAgent === null ? '请选择单个 Agent 后再加载配置文件。' : configAvailabilityByAgent.get(configAgent)?.available === false ? '此 Agent 未找到可编辑的配置文件。' : '尚未加载配置文件。');
  }, [configAgent, configAvailabilityByAgent, configPath, requestStatePath]);

  useEffect(() => {
    if (loadState !== 'ready') {
      return;
    }

    let active = true;
    setIsLoadingConfigAvailability(true);
    getConfigAvailabilityRuntime({ statePath: requestStatePath })
      .then(({ agents }) => {
        if (active) {
          setConfigAvailability(agents);
        }
      })
      .catch(() => {
        if (active) {
          setConfigAvailability([]);
        }
      })
      .finally(() => {
        if (active) {
          setIsLoadingConfigAvailability(false);
        }
      });

    return () => {
      active = false;
    };
  }, [loadState, requestStatePath]);

  function commitRuntimeState(state: RuntimeStateSummary): void {
    setRuntimeState(state);
    setStatePath(state.statePath);
    if (state.secrets?.hasGitHubToken === true) {
      setGithubToken('');
      setRememberGitHubToken(false);
      setIsEditingGitHubToken(false);
    }
  }

  function showNotice(tone: Notice['tone'], title: string, copy: string): void {
    setNotice({ tone, title, copy });
  }

  function replaceRemoteDraft(nextDraft: EditableAgentConfig): void {
    const providerId = nextDraft.providers[nextDraft.defaults.provider] === undefined ? Object.keys(nextDraft.providers)[0] ?? '' : nextDraft.defaults.provider;
    const provider = providerDraft(nextDraft, providerId);
    const modelId = provider.models[nextDraft.defaults.model] === undefined ? Object.keys(provider.models)[0] ?? '' : nextDraft.defaults.model;

    setRemoteDraft(nextDraft);
    setRemoteEditorProviderId(providerId);
    setRemoteEditorModelId(modelId);
  }

  async function refreshState(nextStatePath?: string): Promise<void> {
    const { state } = await getRuntimeState(nextStatePath);
    commitRuntimeState(state);
    setGistId(state.gist.id ?? gistId);
    setLoadState('ready');
  }

  async function handleInitSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
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
        replaceRemoteDraft(configToDraft(response.config));
        setRemoteStatus('已发现并加载远端配置。表单显示的是当前远端完整值。');
      } else {
        replaceRemoteDraft(EMPTY_REMOTE_CONFIG);
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
      replaceRemoteDraft(configToDraft(response.config));
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
    const validationError = validateRemoteDraft(remoteDraft);
    if (validationError !== null) {
      setNotice({ tone: 'error', title: '远端配置无效', copy: validationError });
      return;
    }

    setIsSavingRemote(true);
    setNotice(null);
    try {
      const response = await saveRemoteConfigRuntime({ ...githubTokenRequest(requestStatePath, nextGithubToken), config: remoteDraft });
      commitRuntimeState(response.state);
      setGistId(response.state.gist.id ?? gistId);
      replaceRemoteDraft(configToDraft(response.config));
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

  function handleSelectRemoteProvider(providerId: string): void {
    setRemoteEditorProviderId(providerId);
    setRemoteEditorModelId(Object.keys(providerDraft(remoteDraft, providerId).models)[0] ?? '');
  }

  function handleAddRemoteProvider(): void {
    setRemoteDraft((currentDraft) => {
      const providerId = uniqueDraftId('provider', currentDraft.providers);
      const modelId = 'model';

      setRemoteEditorProviderId(providerId);
      setRemoteEditorModelId(modelId);

      return {
        ...currentDraft,
        providers: {
          ...currentDraft.providers,
          [providerId]: emptyProviderDraft(modelId),
        },
      };
    });
  }

  function handleRemoveRemoteProvider(): void {
    setRemoteDraft((currentDraft) => {
      const providerIds = Object.keys(currentDraft.providers);
      if (providerIds.length <= 1 || currentDraft.providers[selectedRemoteProviderId] === undefined) {
        return currentDraft;
      }

      const providers = { ...currentDraft.providers };
      delete providers[selectedRemoteProviderId];
      const nextProviderId = providerIds.find((providerId) => providerId !== selectedRemoteProviderId) ?? '';
      const nextModelId = Object.keys(providers[nextProviderId]?.models ?? {})[0] ?? '';
      const defaults =
        currentDraft.defaults.provider === selectedRemoteProviderId
          ? { provider: nextProviderId, model: nextModelId }
          : currentDraft.defaults;

      setRemoteEditorProviderId(nextProviderId);
      setRemoteEditorModelId(nextModelId);

      return removeUnknownOhMyOpenAgentReferences({ ...currentDraft, defaults, providers });
    });
  }

  function handleRemoteProviderIdChange(providerId: string): void {
    const previousProviderId = selectedRemoteProviderId;
    if (providerId !== previousProviderId && remoteDraft.providers[providerId] !== undefined) {
      setNotice({ tone: 'error', title: '提供商 ID 已存在', copy: `提供商 ID "${providerId}" 已被使用。当前提供商保持为 "${previousProviderId}"；请填写唯一 ID 后再继续。` });
      return;
    }

    setRemoteDraft((currentDraft) => renameProviderDraft(currentDraft, previousProviderId, providerId));
    setRemoteEditorProviderId(providerId);
  }

  function updateRemoteProvider(updateProvider: (provider: EditableAgentConfig['providers'][string]) => EditableAgentConfig['providers'][string]): void {
    const providerId = selectedRemoteProviderId;
    setRemoteDraft((currentDraft) => updateProviderDraft(currentDraft, providerId, updateProvider));
  }

  function handleSelectRemoteModel(modelId: string): void {
    setRemoteEditorModelId(modelId);
  }

  function handleAddRemoteModel(): void {
    const providerId = selectedRemoteProviderId;
    setRemoteDraft((currentDraft) => {
      const provider = providerDraft(currentDraft, providerId);
      const modelId = uniqueDraftId('model', provider.models);

      setRemoteEditorModelId(modelId);

      return updateProviderDraft(currentDraft, providerId, (currentProvider) => ({
        ...currentProvider,
        models: {
          ...currentProvider.models,
          [modelId]: {},
        },
      }));
    });
  }

  function handleRemoveRemoteModel(): void {
    const providerId = selectedRemoteProviderId;
    const modelId = selectedRemoteModelId;
    setRemoteDraft((currentDraft) => {
      const provider = providerDraft(currentDraft, providerId);
      const modelIds = Object.keys(provider.models);
      if (modelIds.length <= 1 || provider.models[modelId] === undefined) {
        return currentDraft;
      }

      const models = { ...provider.models };
      delete models[modelId];
      const nextModelId = modelIds.find((candidate) => candidate !== modelId) ?? '';
      const defaults =
        currentDraft.defaults.provider === providerId && currentDraft.defaults.model === modelId
          ? { ...currentDraft.defaults, model: nextModelId }
          : currentDraft.defaults;

      setRemoteEditorModelId(nextModelId);

      return removeUnknownOhMyOpenAgentReferences({
        ...currentDraft,
        defaults,
        providers: {
          ...currentDraft.providers,
          [providerId]: { ...provider, models },
        },
      });
    });
  }

  function handleRemoteModelIdChange(modelId: string): void {
    const providerId = selectedRemoteProviderId;
    const previousModelId = selectedRemoteModelId;
    if (modelId !== previousModelId && selectedRemoteProvider.models[modelId] !== undefined) {
      setNotice({ tone: 'error', title: '模型 ID 已存在', copy: `提供商 "${providerId}" 中已存在模型 ID "${modelId}"。当前模型保持为 "${previousModelId}"；请填写唯一 ID 后再继续。` });
      return;
    }

    setRemoteDraft((currentDraft) => renameModelDraft(currentDraft, providerId, previousModelId, modelId));
    setRemoteEditorModelId(modelId);
  }

  function updateRemoteModel(updateModel: (model: EditableAgentConfig['providers'][string]['models'][string]) => EditableAgentConfig['providers'][string]['models'][string]): void {
    const providerId = selectedRemoteProviderId;
    const modelId = selectedRemoteModelId;
    setRemoteDraft((currentDraft) => updateModelDraft(currentDraft, providerId, modelId, updateModel));
  }

  function handleDefaultRemoteProviderChange(providerId: string): void {
    setRemoteDraft((currentDraft) => ({
      ...currentDraft,
      defaults: {
        provider: providerId,
        model: Object.keys(providerDraft(currentDraft, providerId).models)[0] ?? '',
      },
    }));
  }

  function handleDefaultRemoteModelChange(modelId: string): void {
    setRemoteDraft((currentDraft) => ({
      ...currentDraft,
      defaults: { ...currentDraft.defaults, model: modelId },
    }));
  }

  function handleOhMyOpenAgentModelChange(kind: OhMyOpenAgentAssignmentKind, name: string, modelReference: string): void {
    setRemoteDraft((currentDraft) => withOhMyOpenAgentModel(currentDraft, kind, name, modelReference));
  }

  function handleOhMyOpenAgentVariantChange(kind: OhMyOpenAgentAssignmentKind, name: string, variant: string): void {
    setRemoteDraft((currentDraft) => withOhMyOpenAgentVariant(currentDraft, kind, name, variant));
  }

  function handleClearOhMyOpenAgentAssignment(kind: OhMyOpenAgentAssignmentKind, name: string): void {
    setRemoteDraft((currentDraft) => withOhMyOpenAgentAssignment(currentDraft, kind, name, undefined));
  }

  async function handleDiff(): Promise<void> {
    if (targetRequest === null) {
      setNotice({ tone: 'error', title: '请选择目标', copy: '运行 diff 前请选择支持字段 diff 的目标或全部代理。' });
      return;
    }

    if (targetRequest.agent !== undefined && !agentSupportsManagedFieldDiff(targetRequest.agent)) {
      await handlePlan();
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

  const remoteAccessWarningNode = remoteAccessWarning && (
    <section className="notice" role="alert" aria-live="polite">
      <strong>远程访问警告</strong>
      <span>{remoteAccessWarning}</span>
    </section>
  );

  const noticeStackNode = (remoteAccessWarningNode || noticeNode) && (
    <section className="notice-stack" aria-label="页面提示">
      {remoteAccessWarningNode}
      {noticeNode}
    </section>
  );

  return (
    <main className="app-shell" aria-labelledby="page-title">
        <header className="app-header">
          <div className="app-title-area">
            <p className="eyebrow">本地控制台</p>
            <h1 id="page-title">agentcfg</h1>
          </div>

          <nav className="tab-bar" role="tablist" aria-label="功能切换">
            <TabButton id="connection-tab" active={activeTab === 'connection'} controls="connection-panel" onClick={() => setActiveTab('connection')}>连接 GitHub</TabButton>
            <TabButton id="remote-tab" active={activeTab === 'remote'} controls="remote-panel" onClick={() => setActiveTab('remote')}>远端配置</TabButton>
            <TabButton id="config-tab" active={activeTab === 'config'} controls="config-panel" onClick={() => setActiveTab('config')}>本地配置</TabButton>
            <TabButton id="rules-tab" active={activeTab === 'rules'} controls="rules-panel" onClick={() => setActiveTab('rules')}>规则文件</TabButton>
            <TabButton id="sync-tab" active={activeTab === 'sync'} controls="sync-panel" onClick={() => setActiveTab('sync')}>自动同步</TabButton>
            <TabButton id="execute-tab" active={activeTab === 'execute'} controls="execute-panel" onClick={() => setActiveTab('execute')}>审阅与应用</TabButton>
            <TabButton id="status-tab" active={activeTab === 'status'} controls="status-panel" onClick={() => setActiveTab('status')}>状态详情</TabButton>
          </nav>

          <div className="header-actions" aria-label="状态与同步操作">
            <StatusBadge tone={statusTone(runtimeState)}>
              {loadState === 'loading' ? '正在加载会话' : statusLabel(runtimeState)}
            </StatusBadge>
          </div>
        </header>

        <section className="tab-viewport">
          {noticeStackNode}
          {activeTab === 'connection' && (
            <section className="dashboard-grid dashboard-grid--connection" id="connection-panel" role="tabpanel" aria-labelledby="connection-tab">
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
                  <Detail label="远端基线" value={runtimeState?.conflict.present ? '已保存用于后续比对' : '尚未保存'} />
                </dl>
              </article>
            </section>
          )}

          {activeTab === 'remote' && (
            <section className="dashboard-grid" id="remote-panel" role="tabpanel" aria-labelledby="remote-tab">
              {loadErrorNode}
              <article className="card remote-editor-card">
                <div className="section-heading section-heading--split">
                  <div>
                    <p className="eyebrow">远端配置</p>
                    <h2>用表单生成并保存 agentcfg.yaml，不需要手写 Gist 内容。</h2>
                  </div>
                  <div className="section-actions">
                    <StatusBadge tone={runtimeState?.gist.present ? 'ready' : 'pending'}>{runtimeState?.gist.present ? '已绑定 Gist' : '保存时创建'}</StatusBadge>
                    <button className="secondary-action secondary-action--compact" type="button" onClick={handleLoadRemoteConfig} disabled={isLoadingRemote || isSavingRemote}>
                      {isLoadingRemote ? '正在加载...' : '加载远端配置'}
                    </button>
                    <button
                      className="primary-action primary-action--compact"
                      type={remoteConfigView === 'editor' ? 'submit' : 'button'}
                      form={remoteConfigView === 'editor' ? 'remote-config-form' : undefined}
                      onClick={remoteConfigView === 'editor' ? undefined : () => { void handleSaveRemoteConfig(); }}
                      disabled={isSavingRemote}
                    >
                      {isSavingRemote ? '正在保存...' : '保存远端配置'}
                    </button>
                    <button className="primary-action primary-action--compact" type="button" onClick={handlePull} disabled={isBusy}>
                      <span aria-hidden="true">↓</span>
                      {isPulling ? '正在拉取...' : '拉取远端'}
                    </button>
                  </div>
                </div>
                <div className="config-editor-meta" role="status" aria-live="polite">
                  <span>{remoteStatus}</span>
                  <strong>{runtimeState?.gist.id ?? '尚未绑定 Gist'}</strong>
                </div>
                <div className="remote-view-switch" role="group" aria-label="远端配置视图">
                  <button id="remote-view-editor" className={`remote-view-switch__button ${remoteConfigView === 'editor' ? 'remote-view-switch__button--active' : ''}`} type="button" aria-pressed={remoteConfigView === 'editor'} onClick={() => setRemoteConfigView('editor')}>
                    编辑表单
                  </button>
                  <button id="remote-view-preview" className={`remote-view-switch__button ${remoteConfigView === 'preview' ? 'remote-view-switch__button--active' : ''}`} type="button" aria-pressed={remoteConfigView === 'preview'} onClick={() => setRemoteConfigView('preview')}>
                    预览内容
                  </button>
                </div>
                <div className={`remote-config-layout remote-config-layout--${remoteConfigView}`}>
                  {remoteConfigView === 'editor' ? (
                    <form id="remote-config-form" className="remote-config-form" onSubmit={(event) => { event.preventDefault(); void handleSaveRemoteConfig(); }}>
                      <section className="remote-editor-section remote-editor-section--full" aria-label="提供商列表">
                        <div className="remote-subheading">
                          <div>
                            <p className="eyebrow">提供商</p>
                            <h3>选择或新增提供商</h3>
                          </div>
                          <button className="secondary-action secondary-action--compact" type="button" onClick={handleAddRemoteProvider} disabled={isSavingRemote}>
                            添加提供商
                          </button>
                        </div>
                        <div className="remote-entity-list" role="list" aria-label="已配置提供商">
                          {remoteProviderIds.map((providerId) => (
                            <button className={`remote-entity-chip ${providerId === selectedRemoteProviderId ? 'remote-entity-chip--active' : ''}`} type="button" key={providerId} onClick={() => handleSelectRemoteProvider(providerId)} disabled={isSavingRemote}>
                              <strong>{providerId.trim() === '' ? '未命名提供商' : providerId}</strong>
                              <small>{Object.keys(remoteDraft.providers[providerId]?.models ?? {}).length} 个模型</small>
                            </button>
                          ))}
                        </div>
                      </section>

                      <section className="remote-editor-section" aria-label="提供商字段">
                        <div className="remote-subheading">
                          <div>
                            <p className="eyebrow">提供商配置</p>
                            <h3>端点与可见 API Key</h3>
                          </div>
                          <button className="secondary-action secondary-action--compact" type="button" onClick={handleRemoveRemoteProvider} disabled={isSavingRemote || remoteProviderIds.length <= 1}>
                            删除提供商
                          </button>
                        </div>
                        <label htmlFor="remote-provider">
                          提供商 ID
                          <input id="remote-provider" value={selectedRemoteProviderId} onChange={(event) => handleRemoteProviderIdChange(event.target.value)} autoComplete="off" disabled={isSavingRemote} />
                        </label>
                        <label htmlFor="remote-base-url">
                          Base URL
                          <input id="remote-base-url" value={selectedRemoteProvider.baseURL} onChange={(event) => updateRemoteProvider((provider) => ({ ...provider, baseURL: event.target.value }))} autoComplete="off" disabled={isSavingRemote} />
                        </label>
                        <label htmlFor="remote-api-key">
                          API Key
                          <input id="remote-api-key" type="text" value={selectedRemoteProvider.apiKey.value} onChange={(event) => updateRemoteProvider((provider) => ({ ...provider, apiKey: { type: 'plain', value: event.target.value } }))} placeholder="最终写入 agentcfg.yaml 的 API Key" autoComplete="off" disabled={isSavingRemote} />
                        </label>
                        <label htmlFor="remote-model-discovery-path">
                          模型发现路径
                          <input id="remote-model-discovery-path" value={selectedRemoteProvider.modelDiscovery?.path ?? ''} onChange={(event) => updateRemoteProvider((provider) => withModelDiscoveryPath(provider, event.target.value))} placeholder="/models（可选）" autoComplete="off" disabled={isSavingRemote} />
                        </label>
                      </section>

                      <section className="remote-editor-section" aria-label="模型字段">
                        <div className="remote-subheading">
                          <div>
                            <p className="eyebrow">模型</p>
                            <h3>当前提供商的模型目录</h3>
                          </div>
                          <div className="remote-inline-actions">
                            <button className="secondary-action secondary-action--compact" type="button" onClick={handleAddRemoteModel} disabled={isSavingRemote}>
                              添加模型
                            </button>
                            <button className="secondary-action secondary-action--compact" type="button" onClick={handleRemoveRemoteModel} disabled={isSavingRemote || remoteModelIds.length <= 1}>
                              删除模型
                            </button>
                          </div>
                        </div>
                        <div className="remote-entity-list" role="list" aria-label="当前提供商的模型">
                          {remoteModelIds.map((modelId) => (
                            <button className={`remote-entity-chip ${modelId === selectedRemoteModelId ? 'remote-entity-chip--active' : ''}`} type="button" key={modelId} onClick={() => handleSelectRemoteModel(modelId)} disabled={isSavingRemote}>
                              <strong>{modelId.trim() === '' ? '未命名模型' : modelId}</strong>
                              <small>{modelMetadataCount(selectedRemoteProvider.models[modelId] ?? {})} 项元数据</small>
                            </button>
                          ))}
                        </div>
                        <label htmlFor="remote-model">
                          模型 ID
                          <input id="remote-model" value={selectedRemoteModelId} onChange={(event) => handleRemoteModelIdChange(event.target.value)} autoComplete="off" disabled={isSavingRemote} />
                        </label>
                        <label htmlFor="remote-model-variant">
                          variant 元数据
                          <input id="remote-model-variant" value={selectedRemoteModel.variant ?? ''} onChange={(event) => updateRemoteModel((model) => withOptionalString(model, 'variant', event.target.value))} placeholder="chat（可选）" autoComplete="off" disabled={isSavingRemote} />
                        </label>
                        <label htmlFor="remote-model-context-window">
                          Limit Context（上下文窗口）
                          <input id="remote-model-context-window" type="number" min="1" step="1" value={formatOptionalNumber(selectedRemoteModel.contextWindow)} onChange={(event) => updateRemoteModel((model) => withOptionalNumber(model, 'contextWindow', event.target.value))} placeholder="可选正整数" autoComplete="off" disabled={isSavingRemote} />
                        </label>
                        <label htmlFor="remote-model-context-tokens">
                          Limit Input（输入预算）
                          <input id="remote-model-context-tokens" type="number" min="1" step="1" value={formatOptionalNumber(selectedRemoteModel.contextTokens)} onChange={(event) => updateRemoteModel((model) => withOptionalNumber(model, 'contextTokens', event.target.value))} placeholder="可选正整数" autoComplete="off" disabled={isSavingRemote} />
                        </label>
                        <label htmlFor="remote-model-max-tokens">
                          Limit Output（输出上限）
                          <input id="remote-model-max-tokens" type="number" min="1" step="1" value={formatOptionalNumber(selectedRemoteModel.maxTokens)} onChange={(event) => updateRemoteModel((model) => withOptionalNumber(model, 'maxTokens', event.target.value))} placeholder="可选正整数" autoComplete="off" disabled={isSavingRemote} />
                        </label>
                      </section>

                      <section className="remote-editor-section remote-editor-section--full" aria-label="默认提供商和模型">
                        <div className="remote-subheading">
                          <div>
                            <p className="eyebrow">默认项</p>
                            <h3>显式默认提供商 / 模型</h3>
                          </div>
                        </div>
                        <label htmlFor="remote-default-provider">
                          默认提供商
                          <select id="remote-default-provider" value={defaultProvider} onChange={(event) => handleDefaultRemoteProviderChange(event.target.value)} disabled={isSavingRemote}>
                            {remoteProviderIds.map((providerId) => (
                              <option value={providerId} key={providerId}>{providerId.trim() === '' ? '未命名提供商' : providerId}</option>
                            ))}
                          </select>
                        </label>
                        <label htmlFor="remote-default-model">
                          默认模型
                          <select id="remote-default-model" value={remoteDraft.defaults.model} onChange={(event) => handleDefaultRemoteModelChange(event.target.value)} disabled={isSavingRemote}>
                            {defaultProviderModelIds.map((modelId) => (
                              <option value={modelId} key={modelId}>{modelId.trim() === '' ? '未命名模型' : modelId}</option>
                            ))}
                          </select>
                        </label>
                      </section>

                      <OhMyOpenAgentMappingEditor
                        config={remoteDraft}
                        modelReferences={remoteModelReferenceOptions}
                        isSavingRemote={isSavingRemote}
                        onModelChange={handleOhMyOpenAgentModelChange}
                        onVariantChange={handleOhMyOpenAgentVariantChange}
                        onClear={handleClearOhMyOpenAgentAssignment}
                      />

                    </form>
                  ) : (
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
                  )}
                </div>
              </article>
            </section>
          )}

          {activeTab === 'config' && (
            <section className="dashboard-grid dashboard-grid--config" id="config-panel" role="tabpanel" aria-labelledby="config-tab">
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
                    {CONFIG_TARGET_OPTIONS.map((target) => {
                      const availability = configAvailabilityByAgent.get(target.value);
                      const unavailable = availability?.available === false;
                      return (
                        <label className="target-option" key={target.value}>
                          <input
                            type="radio"
                            name="config-target-mode"
                            value={target.value}
                            checked={targetMode === target.value}
                            onChange={() => setTargetMode(target.value)}
                            disabled={isLoadingConfigAvailability || unavailable}
                          />
                          <span>
                            <strong>{target.title}</strong>
                            <small>{unavailable ? availability.reason ?? '未找到可编辑的配置文件。' : target.copy}</small>
                          </span>
                        </label>
                      );
                    })}
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
                      留空时使用检测到的默认原生配置；仅当所选代理的原生配置在其他文件或目录时填写。该值会同时作为 diff、dry-run、应用的路径覆盖。
                    </div>
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
                    <div className="local-sync-panel" aria-label="本地配置同步与应用">
                      <div className="path-note">
                        <span>同步目标</span>
                        <strong>{localSyncTargetLabel}</strong>
                        <p>{localReviewActionCopyForAgent(configAgent)}</p>
                      </div>
                      <div className="review-actions" aria-label="本地配置 Diff 与应用操作">
                        {showLocalConfigDiffButton && (
                          <button className="secondary-action" type="button" onClick={handleDiff} disabled={!canReviewLocalConfigManagedDiff}>
                            {isDiffing ? '正在 diff...' : '运行 diff'}
                          </button>
                        )}
                        <button className="secondary-action" type="button" onClick={handlePlan} disabled={!canReviewLocalConfig}>
                          {isPlanning ? '正在规划...' : '执行 dry-run'}
                        </button>
                      </div>
                      <div className="apply-lock" aria-label="本地配置应用安全门禁">
                        <div>
                          <p className="eyebrow">强确认门禁</p>
                          <h3>输入 APPLY 后应用当前本地目标。</h3>
                          <p>只有所选本地配置目标与路径匹配最新 dry-run，应用才会解锁。</p>
                        </div>
                        <label htmlFor="local-apply-confirmation">
                          确认文本
                          <input
                            id="local-apply-confirmation"
                            value={confirmationText}
                            onChange={(event) => setConfirmationText(event.target.value)}
                            placeholder="APPLY"
                            autoComplete="off"
                            disabled={!canConfirmLocalConfig}
                          />
                        </label>
                        <button className="primary-action" type="button" onClick={handleApply} disabled={!canApplyLocalConfig}>
                          {isApplying ? '正在应用...' : '应用所选目标'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="config-editor-meta" role="status" aria-live="polite">
                  <span>{configStatus}</span>
                  {configFile !== null && <strong>{configFile.path}</strong>}
                </div>
                <section className="review-results config-review-results" aria-label="本地配置 Diff、dry-run 与应用结果">
                  <DiffResults results={diffResponse?.results ?? null} />
                  <PlanResults plans={planResponse?.plans ?? null} results={planResponse?.results ?? null} stale={planResponse !== null && !isPlanCurrent} />
                  <ApplyResults results={applyResults} />
                </section>
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

          {activeTab === 'rules' && (
            <RulesPanel
              runtimeState={runtimeState}
              requestStatePath={requestStatePath}
              buildGitHubTokenRequest={() => githubTokenRequest()}
              onState={commitRuntimeState}
              onNotice={showNotice}
            />
          )}

          {activeTab === 'sync' && (
            <SyncPanel
              runtimeState={runtimeState}
              requestStatePath={requestStatePath}
              buildGitHubTokenRequest={() => githubTokenRequest()}
              onState={commitRuntimeState}
              onNotice={showNotice}
            />
          )}

          {activeTab === 'execute' && (
            <section className="dashboard-grid" id="execute-panel" role="tabpanel" aria-labelledby="execute-tab">
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
                      {showReviewDiffButton && (
                        <button className="secondary-action" type="button" onClick={handleDiff} disabled={!canReviewManagedDiff}>
                          {isDiffing ? '正在 diff...' : '运行 diff'}
                        </button>
                      )}
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
                    <p className="eyebrow">基线</p>
                    <h2>远端基线元数据</h2>
                  </div>
                  <StatusBadge tone={runtimeState?.conflict.present ? 'ready' : 'pending'}>
                    {runtimeState?.conflict.present ? '已保存' : '未保存'}
                  </StatusBadge>
                </div>
                <dl className="detail-list">
                  <Detail label="基线状态" value={runtimeState?.conflict.present ? '已保存远端基线元数据' : '尚未保存远端基线'} />
                  <Detail label="页面含义" value={runtimeState?.conflict.present ? '这是上次拉取或保存时记录的远端版本，用于以后与本地缓存比对。' : '拉取或保存远端配置后，会在这里记录版本基线供后续比较。'} />
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
  const provider = config.providers[config.defaults.provider];

  return (
    <dl className="detail-list config-summary">
      <Detail label="提供方" value={config.defaults.provider} />
      <Detail label="模型" value={config.defaults.model} />
      <Detail label="Base URL" value={provider.baseURL} />
      <Detail label="API 密钥" value={provider.apiKey.value} />
    </dl>
  );
}

function OhMyOpenAgentMappingEditor({
  config,
  isSavingRemote,
  modelReferences,
  onClear,
  onModelChange,
  onVariantChange,
}: {
  config: EditableAgentConfig;
  isSavingRemote: boolean;
  modelReferences: string[];
  onClear: (kind: OhMyOpenAgentAssignmentKind, name: string) => void;
  onModelChange: (kind: OhMyOpenAgentAssignmentKind, name: string, modelReference: string) => void;
  onVariantChange: (kind: OhMyOpenAgentAssignmentKind, name: string, variant: string) => void;
}) {
  return (
    <section className="remote-editor-section remote-editor-section--full ohmy-openagent-editor" aria-label="OhMyOpenAgent 模型路由">
      <div className="remote-subheading">
        <div>
          <p className="eyebrow">OhMyOpenAgent</p>
          <h3>为官方 agent 与 task category 指定模型</h3>
        </div>
      </div>
      <p className="helper-copy ohmy-openagent-editor__copy">
        选项来自上方 providers 模型目录，并保存到专用 <code>ohMyOpenAgent</code> 字段；留空表示继续使用 OhMyOpenAgent 默认路由。
      </p>
      <div className="ohmy-openagent-editor__groups">
        <OhMyOpenAgentMappingGroup
          kind="agents"
          title="Agents"
          names={OH_MY_OPENAGENT_AGENT_NAMES}
          assignments={config.ohMyOpenAgent?.agents ?? {}}
          modelReferences={modelReferences}
          isSavingRemote={isSavingRemote}
          onModelChange={onModelChange}
          onVariantChange={onVariantChange}
          onClear={onClear}
        />
        <OhMyOpenAgentMappingGroup
          kind="categories"
          title="Task categories"
          names={OH_MY_OPENAGENT_CATEGORY_NAMES}
          assignments={config.ohMyOpenAgent?.categories ?? {}}
          modelReferences={modelReferences}
          isSavingRemote={isSavingRemote}
          onModelChange={onModelChange}
          onVariantChange={onVariantChange}
          onClear={onClear}
        />
      </div>
    </section>
  );
}

function OhMyOpenAgentMappingGroup({
  assignments,
  isSavingRemote,
  kind,
  modelReferences,
  names,
  onClear,
  onModelChange,
  onVariantChange,
  title,
}: {
  assignments: Record<string, OhMyOpenAgentModelAssignment>;
  isSavingRemote: boolean;
  kind: OhMyOpenAgentAssignmentKind;
  modelReferences: string[];
  names: readonly string[];
  onClear: (kind: OhMyOpenAgentAssignmentKind, name: string) => void;
  onModelChange: (kind: OhMyOpenAgentAssignmentKind, name: string, modelReference: string) => void;
  onVariantChange: (kind: OhMyOpenAgentAssignmentKind, name: string, variant: string) => void;
  title: string;
}) {
  return (
    <section className="ohmy-openagent-group" aria-label={`OhMyOpenAgent ${title}`}>
      <h4>{title}</h4>
      <div className="ohmy-openagent-rows">
        {names.map((name) => {
          const assignment = assignments[name];
          const modelSelectId = `remote-ohmyopenagent-${kind}-${name}-model`;
          const variantSelectId = `remote-ohmyopenagent-${kind}-${name}-variant`;
          return (
            <div className="ohmy-openagent-row" key={name}>
              <div className="ohmy-openagent-row__name">
                <strong>{name}</strong>
                <small>{assignment?.model ?? '使用默认路由'}</small>
              </div>
              <label htmlFor={modelSelectId}>
                模型
                <select id={modelSelectId} value={assignment?.model ?? ''} onChange={(event) => onModelChange(kind, name, event.target.value)} disabled={isSavingRemote}>
                  <option value="">OhMyOpenAgent 默认</option>
                  {modelReferences.map((modelReference) => (
                    <option value={modelReference} key={modelReference}>{modelReference}</option>
                  ))}
                </select>
              </label>
              <label htmlFor={variantSelectId}>
                variant
                <select id={variantSelectId} value={assignment?.variant ?? ''} onChange={(event) => onVariantChange(kind, name, event.target.value)} disabled={isSavingRemote || assignment === undefined}>
                  <option value="">不指定</option>
                  {OH_MY_OPENAGENT_MODEL_VARIANTS.map((variant) => (
                    <option value={variant} key={variant}>{variant}</option>
                  ))}
                </select>
              </label>
              <button className="secondary-action secondary-action--compact" type="button" onClick={() => onClear(kind, name)} disabled={isSavingRemote || assignment === undefined}>
                清除
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function providerDraft(config: EditableAgentConfig, providerId: string): EditableAgentConfig['providers'][string] {
  return config.providers[providerId] ?? emptyProviderDraft(config.defaults.model);
}

function modelDraft(provider: EditableAgentConfig['providers'][string], modelId: string): EditableAgentConfig['providers'][string]['models'][string] {
  return provider.models[modelId] ?? {};
}

function updateProviderDraft(config: EditableAgentConfig, providerId: string, updateProvider: (provider: EditableAgentConfig['providers'][string]) => EditableAgentConfig['providers'][string]): EditableAgentConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: updateProvider(providerDraft(config, providerId)),
    },
  };
}

function updateModelDraft(config: EditableAgentConfig, providerId: string, modelId: string, updateModel: (model: EditableAgentConfig['providers'][string]['models'][string]) => EditableAgentConfig['providers'][string]['models'][string]): EditableAgentConfig {
  return updateProviderDraft(config, providerId, (provider) => ({
    ...provider,
    models: {
      ...provider.models,
      [modelId]: updateModel(modelDraft(provider, modelId)),
    },
  }));
}

function renameProviderDraft(config: EditableAgentConfig, previousProviderId: string, nextProviderId: string): EditableAgentConfig {
  if (previousProviderId === nextProviderId) {
    return config;
  }
  if (config.providers[nextProviderId] !== undefined) {
    return config;
  }

  const provider = providerDraft(config, previousProviderId);
  const providers = { ...config.providers };
  delete providers[previousProviderId];
  providers[nextProviderId] = provider;

  return {
    ...config,
    defaults: config.defaults.provider === previousProviderId ? { ...config.defaults, provider: nextProviderId } : config.defaults,
    providers,
    ohMyOpenAgent: remapOhMyOpenAgentProviderReference(config.ohMyOpenAgent, previousProviderId, nextProviderId),
  };
}

function renameModelDraft(config: EditableAgentConfig, providerId: string, previousModelId: string, nextModelId: string): EditableAgentConfig {
  if (previousModelId === nextModelId) {
    return config;
  }

  const provider = providerDraft(config, providerId);
  if (provider.models[nextModelId] !== undefined) {
    return config;
  }

  const model = modelDraft(provider, previousModelId);
  const models = { ...provider.models };
  delete models[previousModelId];
  models[nextModelId] = model;

  return {
    ...config,
    defaults: config.defaults.provider === providerId && config.defaults.model === previousModelId ? { ...config.defaults, model: nextModelId } : config.defaults,
    providers: {
      ...config.providers,
      [providerId]: { ...provider, models },
    },
    ohMyOpenAgent: remapOhMyOpenAgentModelReference(config.ohMyOpenAgent, providerId, previousModelId, nextModelId),
  };
}

function buildRemoteModelReferenceOptions(config: EditableAgentConfig): string[] {
  return Object.entries(config.providers).flatMap(([providerId, provider]) => (
    Object.keys(provider.models).map((modelId) => `${providerId}/${modelId}`)
  ));
}

function withOhMyOpenAgentModel(config: EditableAgentConfig, kind: OhMyOpenAgentAssignmentKind, name: string, modelReference: string): EditableAgentConfig {
  if (modelReference === '') {
    return withOhMyOpenAgentAssignment(config, kind, name, undefined);
  }

  const currentAssignment = config.ohMyOpenAgent?.[kind]?.[name];
  return withOhMyOpenAgentAssignment(config, kind, name, {
    model: modelReference,
    ...(currentAssignment?.variant === undefined ? {} : { variant: currentAssignment.variant }),
  });
}

function withOhMyOpenAgentVariant(config: EditableAgentConfig, kind: OhMyOpenAgentAssignmentKind, name: string, variant: string): EditableAgentConfig {
  const currentAssignment = config.ohMyOpenAgent?.[kind]?.[name];
  if (currentAssignment === undefined) {
    return config;
  }

  return withOhMyOpenAgentAssignment(config, kind, name, {
    model: currentAssignment.model,
    ...(variant === '' ? {} : { variant: normalizeOhMyOpenAgentVariant(variant) }),
  });
}

function withOhMyOpenAgentAssignment(config: EditableAgentConfig, kind: OhMyOpenAgentAssignmentKind, name: string, assignment: OhMyOpenAgentModelAssignment | undefined): EditableAgentConfig {
  const existingConfig = config.ohMyOpenAgent ?? {};
  const assignments = { ...(existingConfig[kind] ?? {}) };

  if (assignment === undefined) {
    delete assignments[name];
  } else {
    assignments[name] = assignment;
  }

  const nextOhMyOpenAgent = compactOhMyOpenAgentConfig({
    ...existingConfig,
    ...(Object.keys(assignments).length === 0 ? { [kind]: undefined } : { [kind]: assignments }),
  });

  return {
    ...config,
    ...(nextOhMyOpenAgent === undefined ? { ohMyOpenAgent: undefined } : { ohMyOpenAgent: nextOhMyOpenAgent }),
  };
}

function removeUnknownOhMyOpenAgentReferences(config: EditableAgentConfig): EditableAgentConfig {
  if (config.ohMyOpenAgent === undefined) {
    return config;
  }

  const knownReferences = new Set(buildRemoteModelReferenceOptions(config));
  const agents = filterKnownOhMyOpenAgentAssignments(config.ohMyOpenAgent.agents, knownReferences);
  const categories = filterKnownOhMyOpenAgentAssignments(config.ohMyOpenAgent.categories, knownReferences);
  const ohMyOpenAgent = compactOhMyOpenAgentConfig({ agents, categories });

  return {
    ...config,
    ...(ohMyOpenAgent === undefined ? { ohMyOpenAgent: undefined } : { ohMyOpenAgent }),
  };
}

function remapOhMyOpenAgentProviderReference(config: EditableAgentConfig['ohMyOpenAgent'], previousProviderId: string, nextProviderId: string): EditableAgentConfig['ohMyOpenAgent'] {
  return compactOhMyOpenAgentConfig({
    agents: remapOhMyOpenAgentAssignments(config?.agents, (assignment) => remapProviderModelReference(assignment, `${previousProviderId}/`, `${nextProviderId}/`)),
    categories: remapOhMyOpenAgentAssignments(config?.categories, (assignment) => remapProviderModelReference(assignment, `${previousProviderId}/`, `${nextProviderId}/`)),
  });
}

function remapOhMyOpenAgentModelReference(config: EditableAgentConfig['ohMyOpenAgent'], providerId: string, previousModelId: string, nextModelId: string): EditableAgentConfig['ohMyOpenAgent'] {
  const previousReference = `${providerId}/${previousModelId}`;
  const nextReference = `${providerId}/${nextModelId}`;
  return compactOhMyOpenAgentConfig({
    agents: remapOhMyOpenAgentAssignments(config?.agents, (assignment) => (assignment.model === previousReference ? { ...assignment, model: nextReference } : assignment)),
    categories: remapOhMyOpenAgentAssignments(config?.categories, (assignment) => (assignment.model === previousReference ? { ...assignment, model: nextReference } : assignment)),
  });
}

function remapProviderModelReference(assignment: OhMyOpenAgentModelAssignment, previousPrefix: string, nextPrefix: string): OhMyOpenAgentModelAssignment {
  return assignment.model.startsWith(previousPrefix)
    ? { ...assignment, model: `${nextPrefix}${assignment.model.slice(previousPrefix.length)}` }
    : assignment;
}

function remapOhMyOpenAgentAssignments(
  assignments: Record<string, OhMyOpenAgentModelAssignment> | undefined,
  remapAssignment: (assignment: OhMyOpenAgentModelAssignment) => OhMyOpenAgentModelAssignment,
): Record<string, OhMyOpenAgentModelAssignment> | undefined {
  if (assignments === undefined) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(assignments).map(([name, assignment]) => [name, remapAssignment(assignment)]));
}

function filterKnownOhMyOpenAgentAssignments(assignments: Record<string, OhMyOpenAgentModelAssignment> | undefined, knownReferences: Set<string>): Record<string, OhMyOpenAgentModelAssignment> | undefined {
  if (assignments === undefined) {
    return undefined;
  }

  const filteredAssignments = Object.fromEntries(Object.entries(assignments).filter(([, assignment]) => knownReferences.has(assignment.model)));
  return Object.keys(filteredAssignments).length === 0 ? undefined : filteredAssignments;
}

function compactOhMyOpenAgentConfig(config: EditableAgentConfig['ohMyOpenAgent']): EditableAgentConfig['ohMyOpenAgent'] {
  const agents = config?.agents === undefined || Object.keys(config.agents).length === 0 ? undefined : config.agents;
  const categories = config?.categories === undefined || Object.keys(config.categories).length === 0 ? undefined : config.categories;

  if (agents === undefined && categories === undefined) {
    return undefined;
  }

  return {
    ...(agents === undefined ? {} : { agents }),
    ...(categories === undefined ? {} : { categories }),
  };
}

function normalizeOhMyOpenAgentVariant(variant: string): OhMyOpenAgentModelVariant | undefined {
  return (OH_MY_OPENAGENT_MODEL_VARIANTS as readonly string[]).includes(variant) ? (variant as OhMyOpenAgentModelVariant) : undefined;
}

function emptyProviderDraft(modelId: string): EditableAgentConfig['providers'][string] {
  return {
    baseURL: '',
    apiKey: { type: 'plain', value: '' },
    models: { [modelId]: {} },
  };
}

function uniqueDraftId(baseId: string, records: Record<string, unknown>): string {
  if (records[baseId] === undefined) {
    return baseId;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (records[candidate] === undefined) {
      return candidate;
    }
  }
}

function withModelDiscoveryPath(provider: EditableAgentConfig['providers'][string], path: string): EditableAgentConfig['providers'][string] {
  if (path.trim() === '') {
    const { modelDiscovery: _modelDiscovery, ...providerWithoutDiscovery } = provider;
    return providerWithoutDiscovery;
  }

  return { ...provider, modelDiscovery: { path } };
}

function withOptionalString<T extends Record<string, unknown>, K extends keyof T>(record: T, key: K, value: string): T {
  if (value.trim() === '') {
    const nextRecord = { ...record };
    delete nextRecord[key];
    return nextRecord;
  }

  return { ...record, [key]: value };
}

function withOptionalNumber<T extends Record<string, unknown>, K extends keyof T>(record: T, key: K, value: string): T {
  if (value.trim() === '') {
    const nextRecord = { ...record };
    delete nextRecord[key];
    return nextRecord;
  }

  return { ...record, [key]: Number(value) };
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function modelMetadataCount(model: EditableAgentConfig['providers'][string]['models'][string]): number {
  return [model.variant, model.contextWindow, model.contextTokens, model.maxTokens].filter((value) => value !== undefined).length;
}

function validateRemoteDraft(config: EditableAgentConfig): string | null {
  const providerEntries = Object.entries(config.providers);
  if (providerEntries.length === 0) {
    return '至少需要一个提供商。';
  }

  if (config.providers[config.defaults.provider] === undefined) {
    return '默认提供商必须指向已配置的提供商。';
  }

  if (config.providers[config.defaults.provider]?.models[config.defaults.model] === undefined) {
    return '默认模型必须属于默认提供商。';
  }

  for (const [providerId, provider] of providerEntries) {
    const providerLabel = providerId.trim() === '' ? '未命名提供商' : providerId;
    if (providerId.trim() === '') {
      return '提供商 ID 不能为空。';
    }
    if (providerId.includes('/')) {
      return `${providerLabel} 的提供商 ID 不能包含 /，因为 OhMyOpenAgent model 使用 provider/model 引用格式。`;
    }
    if (provider.baseURL.trim() === '') {
      return `${providerLabel} 的 Base URL 不能为空。`;
    }
    if (provider.apiKey.value.trim() === '') {
      return `${providerLabel} 的 API Key 不能为空；Web 页面不隐藏或沿用不可见密钥。`;
    }
    if (provider.modelDiscovery !== undefined && (provider.modelDiscovery.path.trim() === '' || !provider.modelDiscovery.path.startsWith('/'))) {
      return `${providerLabel} 的模型发现路径必须留空或以 / 开头。`;
    }

    const modelEntries = Object.entries(provider.models);
    if (modelEntries.length === 0) {
      return `${providerLabel} 至少需要一个模型。`;
    }

    for (const [modelId, model] of modelEntries) {
      const modelLabel = modelId.trim() === '' ? '未命名模型' : modelId;
      if (modelId.trim() === '') {
        return `${providerLabel} 的模型 ID 不能为空。`;
      }
      if (model.variant !== undefined && model.variant.trim() === '') {
        return `${providerLabel}/${modelLabel} 的 variant 必须留空或填写非空文本。`;
      }
      for (const field of ['contextWindow', 'contextTokens', 'maxTokens'] as const) {
        if (model[field] !== undefined && (!Number.isInteger(model[field]) || model[field] <= 0)) {
          return `${providerLabel}/${modelLabel} 的 ${field} 必须留空或填写正整数。`;
        }
      }
    }
  }

  const ohMyOpenAgentValidation = validateOhMyOpenAgentDraft(config);
  if (ohMyOpenAgentValidation !== null) {
    return ohMyOpenAgentValidation;
  }

  return null;
}

function validateOhMyOpenAgentDraft(config: EditableAgentConfig): string | null {
  if (config.ohMyOpenAgent === undefined) {
    return null;
  }

  const knownReferences = new Set(buildRemoteModelReferenceOptions(config));
  const allowedAgentNames = new Set<string>(OH_MY_OPENAGENT_AGENT_NAMES);
  const allowedCategoryNames = new Set<string>(OH_MY_OPENAGENT_CATEGORY_NAMES);
  const variantNames = new Set<string>(OH_MY_OPENAGENT_MODEL_VARIANTS);
  const groups: Array<{ assignments: Record<string, OhMyOpenAgentModelAssignment> | undefined; allowedNames: Set<string>; label: string }> = [
    { assignments: config.ohMyOpenAgent.agents, allowedNames: allowedAgentNames, label: 'agent' },
    { assignments: config.ohMyOpenAgent.categories, allowedNames: allowedCategoryNames, label: 'task category' },
  ];

  for (const group of groups) {
    for (const [name, assignment] of Object.entries(group.assignments ?? {})) {
      if (!group.allowedNames.has(name)) {
        return `OhMyOpenAgent ${group.label} "${name}" 不是当前支持的官方名称。`;
      }
      if (!knownReferences.has(assignment.model)) {
        return `OhMyOpenAgent ${group.label} "${name}" 的模型必须来自当前 providers 模型目录。`;
      }
      if (assignment.variant !== undefined && !variantNames.has(assignment.variant)) {
        return `OhMyOpenAgent ${group.label} "${name}" 的 variant 必须是 max、high、medium、low 或 xhigh。`;
      }
    }
  }

  return null;
}

function DiffResults({ results }: { results: AgentDiffResult[] | null }) {
  if (results === null) {
    return <EmptyCopy title="尚未运行 diff" copy="选择目标后运行 diff，以比较托管字段。" />;
  }

  const fieldDiffResults = results.filter((result) => agentSupportsManagedFieldDiff(result.agent));
  if (fieldDiffResults.length === 0) {
    return <EmptyCopy title="字段 diff 不适用" copy="此目标使用 dry-run 文件预览审阅变更。" />;
  }

  return (
    <section className="result-stack" aria-label="Diff 结果">
      <ResultHeading eyebrow="Diff" title="托管字段变更" />
      {fieldDiffResults.map((result) => (
        <AgentChangeCard
          key={result.agent}
          title={agentLabel(result.agent)}
          subtitle="当前原生值 -> 预期缓存值"
          changes={result.changes}
          notices={result.notices}
        />
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
          <NoticeList notices={plan.notices} />
          <PathList title="操作路径" paths={plan.operationPaths} empty="不会更改任何文件。" />
          <FilePreviewList previews={plan.filePreviews} />
          {agentSupportsManagedFieldDiff(plan.agent) && <FieldRows changes={plan.changes} />}
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
          <NoticeList notices={result.notices} />
          <PathList title="备份路径" paths={result.backups} empty="未返回备份。" />
          {agentSupportsManagedFieldDiff(result.agent) && <FieldRows changes={result.changes} />}
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

function AgentChangeCard({ title, subtitle, changes, notices }: { title: string; subtitle: string; changes: ManagedDiffChange[]; notices: ManagedDiffNotice[] }) {
  return (
    <article className="agent-result-card">
      <div className="agent-result-card__header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <StatusBadge tone={changes.length > 0 ? 'warning' : 'ready'}>{changes.length > 0 ? '有变更' : '未变化'}</StatusBadge>
      </div>
      <NoticeList notices={notices} />
      <FieldRows changes={changes} />
    </article>
  );
}

function NoticeList({ notices }: { notices: ManagedDiffNotice[] }) {
  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="managed-notice-list" role="note" aria-label="托管字段提示">
      <strong>注意事项</strong>
      <ul>
        {notices.map((notice) => (
          <li key={`${notice.field}-${notice.code}`}>
            <span className="managed-notice-list__field">{fieldLabel(notice.field)}</span>
            <code>{notice.code}</code>
            <span>{notice.message}</span>
          </li>
        ))}
      </ul>
    </div>
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
  const schemaTree = buildSchemaDocTree(AGENTCFG_SCHEMA_DOCS);

  return (
    <section id="remote-schema-preview" className="schema-docs" aria-label="agentcfg.yaml schema 参考">
      <p className="schema-docs__intro">agentcfg.yaml 规范字段。此参考只说明 schema，不镜像本页表单值。</p>
      <div className="schema-docs__tree" aria-label="Schema 字段树">
        {schemaTree.map((node) => renderSchemaDocNode(node, true))}
      </div>
    </section>
  );
}

function buildSchemaDocTree(fields: readonly AgentConfigSchemaDoc[]): SchemaDocTreeNode[] {
  const nodesByPath = new Map<string, SchemaDocTreeNode>();
  const roots: SchemaDocTreeNode[] = [];

  for (const field of fields) {
    nodesByPath.set(field.path, { field, children: [] });
  }

  for (const field of fields) {
    const node = nodesByPath.get(field.path);
    if (node === undefined) {
      continue;
    }

    const parent = nodesByPath.get(parentSchemaPath(field.path));
    if (parent === undefined) {
      roots.push(node);
      continue;
    }

    parent.children.push(node);
  }

  return roots;
}

function parentSchemaPath(path: string): string {
  const segments = path.split('.');
  segments.pop();
  return segments.join('.');
}

function renderSchemaDocNode(node: SchemaDocTreeNode, isRoot: boolean) {
  return (
    <details className="schema-docs__node" data-schema-path={node.field.path} key={node.field.path} open={isRoot}>
      <summary className="schema-docs__summary">
        <span className="schema-docs__summary-main">
          <code>{node.field.path}</code>
          <strong>{node.field.label}</strong>
        </span>
        <span className="schema-docs__badge">{node.field.required ? '必填' : '可选'}</span>
      </summary>
      <div className="schema-docs__body">
        <span>类型：{node.field.type}</span>
        <p>{node.field.description}</p>
      </div>
      {node.children.length > 0 && (
        <div className="schema-docs__children">
          {node.children.map((child) => renderSchemaDocNode(child, false))}
        </div>
      )}
    </details>
  );
}

export default App;
