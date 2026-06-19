import { type SyntheticEvent, useEffect, useMemo, useState } from 'react';
import { CommandCenterShell } from './CommandCenterShell';
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
  type ConfigAvailabilityEntry,
  type ConfigFileRuntimeResponse,
  type PlanApplyRuntimeResponse,
  type RuntimeStateSummary,
  type RuntimeTargetRequest,
} from './api';
import {
  agentLabel,
  buildRemoteYamlPreview,
  buildSetupSteps,
  configToDraft,
  extractApplyResults,
  formatDate,
  formatError,
  remoteAccessWarningForHostname,
  type Step,
} from './view-model';
import { NOTICES } from './strings';
import { ConnectionPanel } from './panels/ConnectionPanel';
import { ExecutePanel } from './panels/ExecutePanel';
import { LocalConfigPanel } from './panels/LocalConfigPanel';
import {
  RemoteConfigPanel,
  type OhMyOpenAgentAssignmentKind,
  type RemoteConfigView,
} from './panels/RemoteConfigPanel';
import {
  buildRemoteModelReferenceOptions,
  emptyProviderDraft,
  modelDraft,
  providerDraft,
  removeUnknownOhMyOpenAgentReferences,
  renameModelDraft,
  renameProviderDraft,
  uniqueDraftId,
  updateModelDraft,
  updateProviderDraft,
  validateRemoteDraft,
  withOhMyOpenAgentAssignment,
  withOhMyOpenAgentModel,
  withOhMyOpenAgentVariant,
} from './panels/remote-draft';

type Notice = ToastNotice;

type TargetMode = AgentName | 'all' | '';

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
              planResponse={planResponse}
              isPlanCurrent={isPlanCurrent}
              applyResults={applyResults}
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
            <ExecutePanel
              runtimeState={runtimeState}
              loadErrorNode={loadErrorNode}
              targetMode={targetMode}
              onTargetModeChange={setTargetMode}
              configPath={configPath}
              onConfigPathChange={setConfigPath}
              requestStatePath={requestStatePath}
              onPlan={handlePlan}
              canReview={canReview}
              isPlanning={isPlanning}
              confirmationText={confirmationText}
              onConfirmationTextChange={setConfirmationText}
              isPlanCurrent={isPlanCurrent}
              canApply={canApply}
              isApplying={isApplying}
              onApply={handleApply}
              planResponse={planResponse}
              applyResults={applyResults}
            />
          )}
        </section>
    </CommandCenterShell>
  );
}

export default App;
