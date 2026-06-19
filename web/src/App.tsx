import { type SyntheticEvent, useEffect, useMemo, useState } from 'react';
import { AgentConfigIcon } from './AgentConfigIcon';
import { CommandCenterShell } from './CommandCenterShell';
import { FileDiffViewer } from './FileDiffViewer';
import { LocalConfigAgentSummary } from './LocalConfigAgentSummary';
import { NoticeToast, type ToastNotice } from './NoticeToast';
import { RulesPanel } from './RulesPanel';
import { SkillsDirectoryPanel } from './SkillsDirectoryPanel';
import { StatusRail } from './StatusRail';
import { SyncPanel } from './SyncPanel';
import { WorkflowOverview } from './WorkflowOverview';
import { buildCommandCenterWorkflow } from './command-center-model';
import type { AppTab } from './navigation';
import { useCommandCenterStatus } from './useCommandCenterStatus';
import {
  type EditableAgentConfig,
  applyRuntime,
  clearSavedGitHubTokenRuntime,
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
  type AgentName,
  type ApplyAgentResult,
  type ApplyFilePreview,
  type ApplyPlanSummary,
  type ConfigAvailabilityEntry,
  type ConfigFileRuntimeResponse,
  type ManagedDiffChange,
  type ManagedDiffNotice,
  type OhMyOpenAgentModelAssignment,
  type OhMyOpenAgentModelVariant,
  type PlanApplyRuntimeResponse,
  type RuntimeStateSummary,
  type RuntimeTargetRequest,
} from './api';
import { OH_MY_OPENAGENT_AGENT_NAMES, OH_MY_OPENAGENT_CATEGORY_NAMES, OH_MY_OPENAGENT_MODEL_VARIANTS } from '../../src/core/schema';
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
  type Step,
} from './view-model';
import {
  BUTTONS,
  GATES,
  NOTICES,
  applyStatusTone,
  configDraftBadge,
  dryRunReadinessBadge,
} from './strings';
import { Detail, EmptyCopy, ResultHeading, StatusBadge } from './widgets';
import { ConnectionPanel } from './panels/ConnectionPanel';
import { LocalConfigPanel } from './panels/LocalConfigPanel';
import {
  RemoteConfigPanel,
  type OhMyOpenAgentAssignmentKind,
  type RemoteConfigView,
} from './panels/RemoteConfigPanel';

type Notice = ToastNotice;

type TargetMode = AgentName | 'all' | '';

const TARGET_OPTIONS: Array<{ value: Exclude<TargetMode, ''>; title: string; copy: string }> = [
  { value: 'codex', title: 'Codex', copy: '检查 ~/.codex 设置与生成的 env 文件。' },
  { value: 'opencode', title: 'OpenCode', copy: '检查一个 OpenCode JSON 或 JSONC 配置。' },
  { value: 'openclaw', title: 'OpenClaw', copy: '检查一个 OpenClaw JSON 或 JSON5 配置。' },
  { value: 'claude', title: 'Claude Code', copy: '检查 Claude Code settings.json 配置。' },
  { value: 'ohmyopenagent', title: 'OhMyOpenAgent', copy: '检查 OhMyOpenAgent 模型路由配置。' },
  { value: 'all', title: '全部代理', copy: '同时处理 Codex、OpenCode、OpenClaw、Claude Code 与 OhMyOpenAgent。' },
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
  const [planResponse, setPlanResponse] = useState<PlanApplyRuntimeResponse | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [applyResults, setApplyResults] = useState<ApplyAgentResult[] | null>(null);
  const [confirmationText, setConfirmationText] = useState('');
  const [activeTab, setActiveTab] = useState<AppTab>('overview');
  const [remoteConfigView, setRemoteConfigView] = useState<RemoteConfigView>('editor');
  const [configFile, setConfigFile] = useState<ConfigFileRuntimeResponse | null>(null);
  const [configAvailability, setConfigAvailability] = useState<ConfigAvailabilityEntry[]>([]);
  const [configDraft, setConfigDraft] = useState('');
  const [configStatus, setConfigStatus] = useState('尚未加载配置文件。');
  const [isSubmittingInit, setIsSubmittingInit] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
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
  const isBusy = isSubmittingInit || isPulling || isPlanning || isApplying || isSettingRemote || isLoadingRemote || isSavingRemote || isClearingGitHubToken || loadState === 'loading';
  const canReview = targetRequest !== null && runtimeState?.cache.present === true && !isBusy;
  const canApply = targetRequest !== null && isPlanCurrent && confirmationText === 'APPLY' && !isBusy;
  const configAgent = targetMode === '' || targetMode === 'all' ? null : targetMode;
  const canReviewLocalConfig = configAgent !== null && canReview;
  const canApplyLocalConfig = configAgent !== null && canApply;
  const canConfirmLocalConfig = configAgent !== null && isPlanCurrent && !isApplying;
  const localSyncTargetLabel = configAgent === null ? '请选择单个本地配置目标' : `${agentLabel(configAgent)} / ${configPath.trim() === '' ? '默认检测路径' : configPath.trim()}`;
  const configBusy = isLoadingConfig || isSavingConfig;
  const configAvailabilityByAgent = useMemo(() => new Map(configAvailability.map((entry) => [entry.agent, entry])), [configAvailability]);
  const isConfigAgentAvailable = configAgent === null ? false : configAvailabilityByAgent.get(configAgent)?.available === true;
  const selectedConfigAvailability = configAgent === null ? undefined : configAvailabilityByAgent.get(configAgent);
  const configPathModeLabel = configPath.trim() === '' ? '默认检测路径' : configPath.trim();
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
  const commandCenterStatus = useCommandCenterStatus({
    loadState,
    requestStatePath,
    onState: commitRuntimeState,
  });
  const workflowSteps = useMemo(
    () =>
      buildCommandCenterWorkflow({
        runtimeState,
        status: commandCenterStatus,
        isPlanCurrent,
        canReview,
        applyResults,
      }),
    [applyResults, canReview, commandCenterStatus, isPlanCurrent, runtimeState],
  );

  useEffect(() => {
    setConfirmationText('');
  }, [reviewKey]);

  useEffect(() => {
    if (notice === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 4500);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

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
        title: NOTICES.connected,
        copy: 'agentcfg 已保存 Gist 身份。准备好后即可拉取远端配置。',
      });
    } catch (error) {
      setNotice({ tone: 'error', title: NOTICES.initFailed, copy: formatError(error) });
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
      setPlanResponse(null);
      setPlanKey(null);
      setApplyResults(null);
      setNotice({
        tone: 'success',
        title: NOTICES.pullSucceeded,
        copy: '控制台现在显示最新的本地缓存与完整代理配置，包括 API Key。',
      });
    } catch (error) {
      setNotice({ tone: 'error', title: NOTICES.pullFailed, copy: formatError(error) });
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
      setNotice({ tone: 'success', title: response.state.gist.present ? NOTICES.connected : NOTICES.remoteReadyToCreate, copy: response.state.gist.present ? '已找到现有 agentcfg Gist，可以继续编辑远端配置。' : '填写远端配置后保存，即可自动创建 agentcfg Gist。' });
    } catch (error) {
      setNotice({ tone: 'error', title: NOTICES.remoteSetupFailed, copy: formatError(error) });
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
      setNotice({ tone: 'success', title: NOTICES.remoteLoaded, copy: '你可以直接修改 provider、model、Base URL，或填写新的 API Key。' });
    } catch (error) {
      setNotice({ tone: 'error', title: NOTICES.remoteLoadFailed, copy: formatError(error) });
    } finally {
      setIsLoadingRemote(false);
    }
  }

  async function handleSaveRemoteConfig(): Promise<void> {
    const nextGithubToken = githubToken.trim();
    const validationError = validateRemoteDraft(remoteDraft);
    if (validationError !== null) {
      setNotice({ tone: 'error', title: NOTICES.remoteValidationFailed, copy: validationError });
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
      setPlanResponse(null);
      setPlanKey(null);
      setApplyResults(null);
      setNotice({ tone: 'success', title: NOTICES.remoteSaved, copy: 'agentcfg.yaml 已写入 Gist，并更新了本地缓存。' });
    } catch (error) {
      setNotice({ tone: 'error', title: NOTICES.remoteSaveFailed, copy: formatError(error) });
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
      setNotice({ tone: 'success', title: NOTICES.tokenCleared, copy: 'secrets.json 中保存的 GitHub Token 已删除；后续远端操作需要重新输入 Token。' });
    } catch (error) {
      setNotice({ tone: 'error', title: NOTICES.tokenClearFailed, copy: formatError(error) });
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

  async function handlePlan(): Promise<void> {
    if (targetRequest === null) {
      setNotice({ tone: 'error', title: NOTICES.selectTarget, copy: '规划写入前请只选择一个目标模式。' });
      return;
    }

    setIsPlanning(true);
    setNotice(null);
    setApplyResults(null);
    try {
      const response = await planApplyRuntime(targetRequest);
      setPlanResponse(response);
      setPlanKey(reviewKey);
      setNotice({ tone: 'success', title: NOTICES.dryRunSucceeded, copy: '检查操作路径，然后输入 APPLY 解锁写入。' });
    } catch (error) {
      setPlanResponse(null);
      setPlanKey(null);
      setNotice({ tone: 'error', title: NOTICES.dryRunFailed, copy: formatError(error) });
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
      setNotice({ tone: 'success', title: NOTICES.applySucceeded, copy: '所选代理文件已更新，控制台状态已刷新。' });
    } catch (error) {
      const results = extractApplyResults(error);
      setApplyResults(results ?? null);
      setNotice({ tone: 'error', title: NOTICES.applyFailed, copy: formatError(error) });
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
      setNotice({ tone: 'error', title: NOTICES.configLoadFailed, copy: formatError(error) });
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
      setPlanResponse(null);
      setPlanKey(null);
      setApplyResults(null);
      setConfirmationText('');
    } catch (error) {
      setConfigStatus(formatError(error));
      setNotice({ tone: 'error', title: NOTICES.configSaveFailed, copy: formatError(error) });
    } finally {
      setIsSavingConfig(false);
    }
  }

  const loadErrorNode = loadState === 'error' && (
    <section className="empty-state" role="status">
      <p className="eyebrow">状态不可用</p>
      <h2>检查本地服务后重新加载控制台。</h2>
      <p>设置表单仍可使用，但控制台更新前需要 `/api/state` 正常响应。</p>
    </section>
  );

  return (
    <CommandCenterShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      statusRail={<StatusRail runtimeState={runtimeState} commandStatus={commandCenterStatus} configAvailability={configAvailability} />}
    >
        <NoticeToast notice={notice} remoteAccessWarning={remoteAccessWarning} onDismiss={() => setNotice(null)} />
        <section className="tab-viewport">
          {activeTab === 'overview' && (
            <WorkflowOverview steps={workflowSteps} onNavigate={setActiveTab} onRunDryRun={handlePlan} />
          )}
          {activeTab === 'connection' && (
            <ConnectionPanel
              runtimeState={runtimeState}
              loadErrorNode={loadErrorNode}
              githubToken={githubToken}
              githubTokenInputValue={githubTokenInputValue}
              githubTokenPlaceholder={isGitHubTokenLocked ? SAVED_GITHUB_TOKEN_MASK : '粘贴带 gist 权限的 token'}
              onGithubTokenChange={setGithubToken}
              gistId={gistId}
              onGistIdChange={setGistId}
              statePath={statePath}
              onStatePathChange={setStatePath}
              rememberGitHubToken={rememberGitHubToken}
              onRememberGitHubTokenChange={setRememberGitHubToken}
              rememberCheckboxChecked={isReplacingSavedGitHubToken ? githubToken.trim() !== '' : rememberGitHubToken}
              rememberCheckboxLabel={isReplacingSavedGitHubToken ? '替换保存的 Token（自动保存）' : '本地明文保存 Token'}
              hasSavedGitHubToken={hasSavedGitHubToken}
              isEditingGitHubToken={isEditingGitHubToken}
              savedTokenStatusCopy={hasSavedGitHubToken ? (isEditingGitHubToken ? '正在替换已保存 GitHub Token，输入新 Token 后会自动保存。' : '已保存 GitHub Token，输入框已锁定为固定掩码。') : '尚未保存 GitHub Token。'}
              onEditSavedGitHubToken={handleEditSavedGitHubToken}
              onCancelGitHubTokenEdit={handleCancelGitHubTokenEdit}
              onClearSavedGitHubToken={handleClearSavedGitHubToken}
              onInitSubmit={handleInitSubmit}
              submitButtonLabel={isSettingRemote ? '正在连接...' : isSubmittingInit ? '正在保存...' : '连接 GitHub'}
              isGitHubTokenLocked={isGitHubTokenLocked}
              isSubmittingInit={isSubmittingInit}
              isSettingRemote={isSettingRemote}
              isReplacingSavedGitHubToken={isReplacingSavedGitHubToken}
              isClearingGitHubToken={isClearingGitHubToken}
              isBusy={isBusy}
              setupSteps={setupSteps}
            />
          )}

          {activeTab === 'remote' && (
            <RemoteConfigPanel
              runtimeState={runtimeState}
              loadErrorNode={loadErrorNode}
              remoteStatus={remoteStatus}
              onLoadRemoteConfig={handleLoadRemoteConfig}
              onSaveRemoteConfig={handleSaveRemoteConfig}
              onPull={handlePull}
              isLoadingRemote={isLoadingRemote}
              isSavingRemote={isSavingRemote}
              isPulling={isPulling}
              isBusy={isBusy}
              remoteConfigView={remoteConfigView}
              onRemoteConfigViewChange={setRemoteConfigView}
              remoteDraft={remoteDraft}
              remoteProviderIds={remoteProviderIds}
              selectedRemoteProviderId={selectedRemoteProviderId}
              selectedRemoteProvider={selectedRemoteProvider}
              remoteModelIds={remoteModelIds}
              selectedRemoteModelId={selectedRemoteModelId}
              selectedRemoteModel={selectedRemoteModel}
              defaultProvider={defaultProvider}
              defaultProviderModelIds={defaultProviderModelIds}
              remoteModelReferenceOptions={remoteModelReferenceOptions}
              remoteYamlPreview={remoteYamlPreview}
              onSelectRemoteProvider={handleSelectRemoteProvider}
              onAddRemoteProvider={handleAddRemoteProvider}
              onRemoveRemoteProvider={handleRemoveRemoteProvider}
              onRemoteProviderIdChange={handleRemoteProviderIdChange}
              onUpdateRemoteProvider={updateRemoteProvider}
              onSelectRemoteModel={handleSelectRemoteModel}
              onAddRemoteModel={handleAddRemoteModel}
              onRemoveRemoteModel={handleRemoveRemoteModel}
              onRemoteModelIdChange={handleRemoteModelIdChange}
              onUpdateRemoteModel={updateRemoteModel}
              onDefaultRemoteProviderChange={handleDefaultRemoteProviderChange}
              onDefaultRemoteModelChange={handleDefaultRemoteModelChange}
              onOhMyOpenAgentModelChange={handleOhMyOpenAgentModelChange}
              onOhMyOpenAgentVariantChange={handleOhMyOpenAgentVariantChange}
              onClearOhMyOpenAgentAssignment={handleClearOhMyOpenAgentAssignment}
            />
          )}

          {activeTab === 'config' && (
            <LocalConfigPanel
              runtimeState={runtimeState}
              loadErrorNode={loadErrorNode}
              targetMode={targetMode}
              onTargetModeChange={setTargetMode}
              configAgent={configAgent}
              configAvailabilityByAgent={configAvailabilityByAgent}
              isLoadingConfigAvailability={isLoadingConfigAvailability}
              selectedConfigAvailability={selectedConfigAvailability}
              configFile={configFile}
              configPathModeLabel={configPathModeLabel}
              configPath={configPath}
              onConfigPathChange={setConfigPath}
              configDraft={configDraft}
              onConfigDraftChange={setConfigDraft}
              configStatus={configStatus}
              onLoadConfigFile={handleLoadConfigFile}
              onSaveConfigFile={handleSaveConfigFile}
              canLoadConfig={canLoadConfig}
              canSaveConfig={canSaveConfig}
              isLoadingConfig={isLoadingConfig}
              isSavingConfig={isSavingConfig}
              localSyncTargetLabel={localSyncTargetLabel}
              onPlan={handlePlan}
              canReviewLocalConfig={canReviewLocalConfig}
              isPlanning={isPlanning}
              confirmationText={confirmationText}
              onConfirmationTextChange={setConfirmationText}
              canConfirmLocalConfig={canConfirmLocalConfig}
              canApplyLocalConfig={canApplyLocalConfig}
              isApplying={isApplying}
              onApply={handleApply}
              planResultsNode={
                <PlanResults plans={planResponse?.plans ?? null} results={planResponse?.results ?? null} stale={planResponse !== null && !isPlanCurrent} />
              }
              applyResultsNode={<ApplyResults results={applyResults} />}
            />
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

          {activeTab === 'skills' && (
            <section className="dashboard-grid dashboard-grid--rules" id="skills-panel" role="tabpanel" aria-labelledby="skills-tab">
              <SkillsDirectoryPanel
                requestStatePath={requestStatePath}
                buildGitHubTokenRequest={() => githubTokenRequest()}
                onState={commitRuntimeState}
                onNotice={showNotice}
              />
            </section>
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
                    <h2>Dry-run、再输入确认应用</h2>
                  </div>
                  {(() => {
                    const badge = dryRunReadinessBadge({ hasPlan: isPlanCurrent, hasTarget: targetMode !== '' });
                    return <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>;
                  })()}
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

                    <div className="review-actions" aria-label="dry-run 与应用操作">
                      <button className="secondary-action" type="button" onClick={handlePlan} disabled={!canReview}>
                        {isPlanning ? BUTTONS.dryRunRunning : BUTTONS.dryRun}
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
                          value={confirmationText}
                          onChange={(event) => setConfirmationText(event.target.value)}
                          placeholder={GATES.applyConfirmPlaceholder}
                          autoComplete="off"
                          disabled={!isPlanCurrent || isApplying}
                        />
                      </label>
                      <button className="primary-action" type="button" onClick={handleApply} disabled={!canApply}>
                        {isApplying ? BUTTONS.applyRunning : BUTTONS.apply}
                      </button>
                    </div>
                  </section>

                  <section className="review-results" aria-label="dry-run 与应用结果">
                    <PlanResults plans={planResponse?.plans ?? null} results={planResponse?.results ?? null} stale={planResponse !== null && !isPlanCurrent} />
                    <ApplyResults results={applyResults} />
                  </section>
                </div>
              </article>
            </section>
          )}
        </section>
    </CommandCenterShell>
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
          <PlanAssociatedFiles plan={plan} />
          <PathList title="将写入路径" paths={plan.operationPaths} empty="关联文件均无需写入。" />
          <FilePreviewList previews={plan.filePreviews} />
          {agentSupportsManagedFieldDiff(plan.agent) && <FieldRows changes={plan.changes} />}
        </article>
      ))}
    </section>
  );
}

type PlanAssociatedFile = {
  readonly label: string;
  readonly path: string;
  readonly willWrite: boolean;
};

function PlanAssociatedFiles({ plan }: { plan: ApplyPlanSummary }) {
  const files = buildPlanAssociatedFiles(plan);

  return (
    <div className="config-associated-files plan-associated-files" aria-label="dry-run 关联文件状态">
      <span>关联文件状态</span>
      <ul>
        {files.map((file) => (
          <li key={`${file.label}:${file.path}`}>
            <strong>{file.label}</strong>
            <code>{file.path}</code>
            <small className={file.willWrite ? 'plan-associated-files__status--write' : undefined}>{file.willWrite ? '将写入' : '本次无写入'}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildPlanAssociatedFiles(plan: ApplyPlanSummary): PlanAssociatedFile[] {
  const operationPaths = new Set(plan.operationPaths);
  const files: PlanAssociatedFile[] = [
    {
      label: '原生配置',
      path: plan.configPath,
      willWrite: operationPaths.has(plan.configPath),
    },
  ];

  if (plan.envPath !== undefined && plan.envPath !== plan.configPath) {
    files.push({
      label: 'Env 文件',
      path: plan.envPath,
      willWrite: operationPaths.has(plan.envPath),
    });
  }

  return files;
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
            <StatusBadge tone={applyStatusTone(result.status)}>{formatStatus(result.status)}</StatusBadge>
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

export default App;
