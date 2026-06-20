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
  type AgentName,
  type ApplyAgentResult,
  type ConfigAvailabilityEntry,
  type ConfigFileRuntimeResponse,
  type PlanApplyRuntimeResponse,
  type RuntimeStateSummary,
} from './api';
import {
  agentLabel,
  buildRemoteYamlPreview,
  buildSetupSteps,
  configToDraft,
  formatDate,
  formatError,
  remoteAccessWarningForHostname,
  type Step,
} from './view-model';
import { NOTICES } from './strings';
import { RemoteSourcePanel } from './panels/RemoteSourcePanel';
import { SyncTargetsPanel } from './panels/SyncTargetsPanel';
import {
  type OhMyOpenAgentAssignmentKind,
  type RemoteConfigView,
} from './panels/RemoteConfigPanel';
import {
  buildRemoteModelReferenceOptions,
  modelDraft,
  providerDraft,
} from './panels/remote-draft';
import {
  EMPTY_REMOTE_DRAFT,
  selectConfigAgent,
  selectIsPlanCurrent,
  selectShouldRememberGitHubToken,
  selectTargetRequest,
  useRemoteDraftStore,
  useRuntimeStore,
  usePlanStore,
} from './stores';

type Notice = ToastNotice;



const SAVED_GITHUB_TOKEN_MASK = '************';

function App() {
  const runtimeState = useRuntimeStore((state) => state.state);
  const loadState = useRuntimeStore((state) => state.loadState);
  const githubToken = useRuntimeStore((state) => state.githubToken);
  const isEditingGitHubToken = useRuntimeStore((state) => state.isEditingGitHubToken);
  const rememberGitHubToken = useRuntimeStore((state) => state.rememberGitHubToken);
  const gistId = useRuntimeStore((state) => state.gistId);
  const statePath = useRuntimeStore((state) => state.statePath);
  const isSubmittingInit = useRuntimeStore((state) => state.isSubmittingInit);
  const isPulling = useRuntimeStore((state) => state.isPulling);
  const isSettingRemote = useRuntimeStore((state) => state.isSettingRemote);
  const isClearingGitHubToken = useRuntimeStore((state) => state.isClearingGitHubToken);
  const setGithubToken = useRuntimeStore((state) => state.setGithubToken);
  const setGistId = useRuntimeStore((state) => state.setGistId);
  const setStatePath = useRuntimeStore((state) => state.setStatePath);
  const setRememberGitHubToken = useRuntimeStore((state) => state.setRememberGitHubToken);
  const beginEditSavedToken = useRuntimeStore((state) => state.beginEditSavedToken);
  const cancelEditSavedToken = useRuntimeStore((state) => state.cancelEditSavedToken);
  const commitRuntimeState = useRuntimeStore((state) => state.commitRuntimeState);

  const remoteDraft = useRemoteDraftStore((state) => state.draft);
  const remoteEditorProviderId = useRemoteDraftStore((state) => state.editorProviderId);
  const remoteEditorModelId = useRemoteDraftStore((state) => state.editorModelId);
  const remoteStatus = useRemoteDraftStore((state) => state.status);
  const remoteConfigView = useRemoteDraftStore((state) => state.view);
  const isLoadingRemote = useRemoteDraftStore((state) => state.isLoading);
  const isSavingRemote = useRemoteDraftStore((state) => state.isSaving);

  const targetMode = usePlanStore((state) => state.targetMode);
  const configPath = usePlanStore((state) => state.configPath);
  const planResponse = usePlanStore((state) => state.planResponse);
  const applyResults = usePlanStore((state) => state.applyResults);
  const confirmationText = usePlanStore((state) => state.confirmationText);
  const configFile = usePlanStore((state) => state.configFile);
  const configAvailability = usePlanStore((state) => state.configAvailability);
  const configDraft = usePlanStore((state) => state.configDraft);
  const configStatus = usePlanStore((state) => state.configStatus);
  const isPlanning = usePlanStore((state) => state.isPlanning);
  const isApplying = usePlanStore((state) => state.isApplying);
  const isLoadingConfigAvailability = usePlanStore((state) => state.isLoadingConfigAvailability);
  const isLoadingConfig = usePlanStore((state) => state.isLoadingConfig);
  const isSavingConfig = usePlanStore((state) => state.isSavingConfig);
  const setTargetMode = usePlanStore((state) => state.setTargetMode);
  const setConfigPath = usePlanStore((state) => state.setConfigPath);
  const setConfirmationText = usePlanStore((state) => state.setConfirmationText);
  const setConfigDraft = usePlanStore((state) => state.setConfigDraft);
  const isPlanCurrent = usePlanStore(selectIsPlanCurrent);
  const configAgent = usePlanStore(selectConfigAgent);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('overview');

  useEffect(() => {
    let active = true;
    const bootstrap = useRuntimeStore.getState().bootstrap;

    bootstrap()
      .then(async (outcome) => {
        if (!active) return;

        if (!outcome.ok) {
          setNotice({ tone: 'error', title: '无法加载状态', copy: formatError(outcome.error) });
          return;
        }

        if (outcome.shouldAutoLoadRemote) {
          const result = await useRemoteDraftStore.getState().load();
          if (!active) return;
          if (result.ok) {
            useRemoteDraftStore.getState().setStatus('远端配置已自动刷新。表单显示的是当前 Gist 完整值；API Key 直接显示。');
          } else {
            useRemoteDraftStore
              .getState()
              .setStatus(`自动刷新远端配置失败：${formatError(result.error)}`);
          }
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const setupSteps = useMemo<Step[]>(() => buildSetupSteps(runtimeState), [runtimeState]);
  const requestStatePath = statePath.trim() === '' ? runtimeState?.statePath : statePath.trim();
  const targetRequest = usePlanStore(selectTargetRequest);
  const reviewKey = usePlanStore((state) => state.planKey ?? '');
  const planKey = usePlanStore((state) => state.planKey);
  const hasSavedGitHubToken = runtimeState?.secrets?.hasGitHubToken === true;
  const isBusy = isSubmittingInit || isPulling || isPlanning || isApplying || isSettingRemote || isLoadingRemote || isSavingRemote || isClearingGitHubToken || loadState === 'loading';
  const canReview = targetRequest !== null && runtimeState?.cache.present === true && !isBusy;
  const canApply = targetRequest !== null && isPlanCurrent && confirmationText === 'APPLY' && !isBusy;
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
    if (notice === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 4500);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notice]);

  useEffect(() => {
    const planStore = usePlanStore.getState();
    planStore.invalidate();
    if (planStore.configFile !== null) {
      usePlanStore.setState({ configFile: null, configDraft: '' });
    }
    const availabilityEntry = configAvailability.find((entry) => entry.agent === configAgent);
    const nextStatus =
      configAgent === null
        ? '请选择单个 Agent 后再加载配置文件。'
        : availabilityEntry?.available === false
          ? '此 Agent 未找到可编辑的配置文件。'
          : '尚未加载配置文件。';
    planStore.setConfigStatus(nextStatus);
  }, [configAgent, configAvailability, configPath, requestStatePath]);

  useEffect(() => {
    if (loadState !== 'ready') {
      return;
    }
    void usePlanStore.getState().refreshAvailability();
  }, [loadState, requestStatePath]);

  function showNotice(tone: Notice['tone'], title: string, copy: string): void {
    setNotice({ tone, title, copy });
  }

  function replaceRemoteDraft(nextDraft: EditableAgentConfig): void {
    useRemoteDraftStore.getState().replaceDraft(nextDraft);
  }

  async function handleInitSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextGithubToken = githubToken.trim();
    const nextGistId = gistId.trim();

    if (nextGithubToken !== '' || nextGistId === '') {
      await handleRemoteSetup();
      return;
    }

    setNotice(null);
    const outcome = await useRuntimeStore.getState().init();
    if (outcome.ok) {
      setNotice({
        tone: 'success',
        title: NOTICES.connected,
        copy: 'agentcfg 已保存 Gist 身份。准备好后即可拉取远端配置。',
      });
    } else {
      setNotice({ tone: 'error', title: NOTICES.initFailed, copy: formatError(outcome.error) });
    }
  }

  async function handlePull(): Promise<void> {
    setNotice(null);
    const outcome = await useRuntimeStore.getState().pull();
    if (outcome.ok) {
      usePlanStore.getState().invalidate();
      setNotice({
        tone: 'success',
        title: NOTICES.pullSucceeded,
        copy: '控制台现在显示最新的本地缓存与完整代理配置，包括 API Key。',
      });
    } else {
      setNotice({ tone: 'error', title: NOTICES.pullFailed, copy: formatError(outcome.error) });
    }
  }

  async function handleRemoteSetup(overrides?: { githubToken?: string; statePath?: string }): Promise<void> {
    setNotice(null);
    const outcome = await useRuntimeStore.getState().setupRemote(overrides);
    if (!outcome.ok) {
      setNotice({ tone: 'error', title: NOTICES.remoteSetupFailed, copy: formatError(outcome.error) });
      return;
    }
    const remoteStore = useRemoteDraftStore.getState();
    if (outcome.config !== undefined) {
      remoteStore.replaceDraft(configToDraft(outcome.config));
      remoteStore.setStatus('已发现并加载远端配置。表单显示的是当前远端完整值。');
    } else {
      remoteStore.replaceDraft(EMPTY_REMOTE_DRAFT);
      remoteStore.setStatus('没有找到现有 agentcfg Gist。填写远端配置并保存后，会自动创建 secret Gist。');
    }
    setActiveTab('remote');
    setNotice({
      tone: 'success',
      title: outcome.bootstrapped ? NOTICES.connected : NOTICES.remoteReadyToCreate,
      copy: outcome.bootstrapped
        ? '已找到现有 agentcfg Gist，可以继续编辑远端配置。'
        : '填写远端配置后保存，即可自动创建 agentcfg Gist。',
    });
  }

  async function handleLoadRemoteConfig(): Promise<void> {
    setNotice(null);
    const outcome = await useRemoteDraftStore.getState().load();
    if (outcome.ok) {
      setNotice({ tone: 'success', title: NOTICES.remoteLoaded, copy: '你可以直接修改 provider、model、Base URL，或填写新的 API Key。' });
    } else {
      setNotice({ tone: 'error', title: NOTICES.remoteLoadFailed, copy: formatError(outcome.error) });
    }
  }

  async function handleSaveRemoteConfig(): Promise<void> {
    setNotice(null);
    const outcome = await useRemoteDraftStore.getState().save();
    if (outcome.ok) {
      usePlanStore.getState().invalidate();
      setNotice({ tone: 'success', title: NOTICES.remoteSaved, copy: 'agentcfg.yaml 已写入 Gist，并更新了本地缓存。' });
      return;
    }
    if (outcome.kind === 'validation') {
      setNotice({ tone: 'error', title: NOTICES.remoteValidationFailed, copy: outcome.message });
    } else {
      setNotice({ tone: 'error', title: NOTICES.remoteSaveFailed, copy: formatError(outcome.error) });
    }
  }

  async function handleClearSavedGitHubToken(): Promise<void> {
    setNotice(null);
    const outcome = await useRuntimeStore.getState().clearSavedToken();
    if (outcome.ok) {
      setNotice({ tone: 'success', title: NOTICES.tokenCleared, copy: 'secrets.json 中保存的 GitHub Token 已删除；后续远端操作需要重新输入 Token。' });
    } else {
      setNotice({ tone: 'error', title: NOTICES.tokenClearFailed, copy: formatError(outcome.error) });
    }
  }

  function buildGitHubTokenRequest(nextStatePath = requestStatePath, nextGithubToken = githubToken.trim()) {
    const remember = selectShouldRememberGitHubToken(useRuntimeStore.getState());
    return {
      statePath: nextStatePath,
      githubToken: nextGithubToken,
      ...(remember && nextGithubToken !== '' ? { rememberGitHubToken: true } : {}),
    };
  }

  function handleSelectRemoteProvider(providerId: string): void {
    useRemoteDraftStore.getState().selectProvider(providerId);
  }

  function handleAddRemoteProvider(): void {
    useRemoteDraftStore.getState().addProvider();
  }

  function handleRemoveRemoteProvider(): void {
    useRemoteDraftStore.getState().removeProvider();
  }

  function handleRemoteProviderIdChange(providerId: string): void {
    const previousProviderId = selectedRemoteProviderId;
    const ok = useRemoteDraftStore.getState().renameProvider(providerId);
    if (!ok) {
      setNotice({
        tone: 'error',
        title: '提供商 ID 已存在',
        copy: `提供商 ID "${providerId}" 已被使用。当前提供商保持为 "${previousProviderId}"；请填写唯一 ID 后再继续。`,
      });
    }
  }

  function updateRemoteProvider(
    update: (provider: EditableAgentConfig['providers'][string]) => EditableAgentConfig['providers'][string],
  ): void {
    useRemoteDraftStore.getState().updateProvider(update);
  }

  function handleSelectRemoteModel(modelId: string): void {
    useRemoteDraftStore.getState().selectModel(modelId);
  }

  function handleAddRemoteModel(): void {
    useRemoteDraftStore.getState().addModel();
  }

  function handleRemoveRemoteModel(): void {
    useRemoteDraftStore.getState().removeModel();
  }

  function handleRemoteModelIdChange(modelId: string): void {
    const providerId = selectedRemoteProviderId;
    const previousModelId = selectedRemoteModelId;
    const ok = useRemoteDraftStore.getState().renameModel(modelId);
    if (!ok) {
      setNotice({
        tone: 'error',
        title: '模型 ID 已存在',
        copy: `提供商 "${providerId}" 中已存在模型 ID "${modelId}"。当前模型保持为 "${previousModelId}"；请填写唯一 ID 后再继续。`,
      });
    }
  }

  function updateRemoteModel(
    update: (
      model: EditableAgentConfig['providers'][string]['models'][string],
    ) => EditableAgentConfig['providers'][string]['models'][string],
  ): void {
    useRemoteDraftStore.getState().updateModel(update);
  }

  function handleDefaultRemoteProviderChange(providerId: string): void {
    useRemoteDraftStore.getState().setDefaultProvider(providerId);
  }

  function handleDefaultRemoteModelChange(modelId: string): void {
    useRemoteDraftStore.getState().setDefaultModel(modelId);
  }

  function handleOhMyOpenAgentModelChange(kind: OhMyOpenAgentAssignmentKind, name: string, modelReference: string): void {
    useRemoteDraftStore.getState().setOhMyOpenAgentModel(kind, name, modelReference);
  }

  function handleOhMyOpenAgentVariantChange(kind: OhMyOpenAgentAssignmentKind, name: string, variant: string): void {
    useRemoteDraftStore.getState().setOhMyOpenAgentVariant(kind, name, variant);
  }

  function handleClearOhMyOpenAgentAssignment(kind: OhMyOpenAgentAssignmentKind, name: string): void {
    useRemoteDraftStore.getState().clearOhMyOpenAgentAssignment(kind, name);
  }

  async function handlePlan(): Promise<void> {
    setNotice(null);
    const outcome = await usePlanStore.getState().plan();
    if (outcome.ok) {
      setNotice({ tone: 'success', title: NOTICES.dryRunSucceeded, copy: '检查操作路径，然后输入 APPLY 解锁写入。' });
      return;
    }
    if (outcome.targetMissing === true) {
      setNotice({ tone: 'error', title: NOTICES.selectTarget, copy: '规划写入前请只选择一个目标模式。' });
      return;
    }
    setNotice({ tone: 'error', title: NOTICES.dryRunFailed, copy: formatError(outcome.error) });
  }

  async function handleApply(): Promise<void> {
    if (!canApply) {
      return;
    }
    setNotice(null);
    const outcome = await usePlanStore.getState().apply();
    if (outcome.ok) {
      setNotice({ tone: 'success', title: NOTICES.applySucceeded, copy: '所选代理文件已更新，控制台状态已刷新。' });
    } else {
      setNotice({ tone: 'error', title: NOTICES.applyFailed, copy: formatError(outcome.error) });
    }
  }

  async function handleLoadConfigFile(): Promise<void> {
    if (configAgent === null) {
      usePlanStore.getState().setConfigStatus('请选择单个代理后再加载配置文件。');
      return;
    }
    setNotice(null);
    const outcome = await usePlanStore.getState().loadConfigFile(configAgent);
    if (!outcome.ok) {
      usePlanStore.getState().setConfigStatus(formatError(outcome.error));
      setNotice({ tone: 'error', title: NOTICES.configLoadFailed, copy: formatError(outcome.error) });
    }
  }

  async function handleSaveConfigFile(): Promise<void> {
    if (configAgent === null || configFile === null) {
      return;
    }
    setNotice(null);
    const outcome = await usePlanStore.getState().saveConfigFile();
    if (!outcome.ok) {
      usePlanStore.getState().setConfigStatus(formatError(outcome.error));
      setNotice({ tone: 'error', title: NOTICES.configSaveFailed, copy: formatError(outcome.error) });
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
          {activeTab === 'remote' && (
            <RemoteSourcePanel
              connection={{
                runtimeState,
                loadErrorNode,
                githubToken,
                githubTokenInputValue,
                githubTokenPlaceholder: isGitHubTokenLocked ? SAVED_GITHUB_TOKEN_MASK : '粘贴带 gist 权限的 token',
                onGithubTokenChange: setGithubToken,
                gistId,
                onGistIdChange: setGistId,
                statePath,
                onStatePathChange: setStatePath,
                rememberGitHubToken,
                onRememberGitHubTokenChange: setRememberGitHubToken,
                rememberCheckboxChecked: isReplacingSavedGitHubToken ? githubToken.trim() !== '' : rememberGitHubToken,
                rememberCheckboxLabel: isReplacingSavedGitHubToken ? '替换保存的 Token（自动保存）' : '本地明文保存 Token',
                hasSavedGitHubToken,
                isEditingGitHubToken,
                savedTokenStatusCopy: hasSavedGitHubToken
                  ? (isEditingGitHubToken
                      ? '正在替换已保存 GitHub Token，输入新 Token 后会自动保存到本机 secrets.json。'
                      : 'GitHub Token 已以明文保存到本机 secrets.json，输入框已锁定为固定掩码。')
                  : '尚未保存 GitHub Token。勾选下方复选框可在连接成功后保存到本机 secrets.json，避免下次重复粘贴。',
                onEditSavedGitHubToken: beginEditSavedToken,
                onCancelGitHubTokenEdit: cancelEditSavedToken,
                onClearSavedGitHubToken: handleClearSavedGitHubToken,
                onInitSubmit: handleInitSubmit,
                submitButtonLabel: isSettingRemote ? '正在连接...' : isSubmittingInit ? '正在保存...' : '连接 GitHub',
                isGitHubTokenLocked,
                isSubmittingInit,
                isSettingRemote,
                isReplacingSavedGitHubToken,
                isClearingGitHubToken,
                isBusy,
                setupSteps,
              }}
              editor={{
                runtimeState,
                loadErrorNode,
                remoteStatus,
                onLoadRemoteConfig: handleLoadRemoteConfig,
                onSaveRemoteConfig: handleSaveRemoteConfig,
                onPull: handlePull,
                isLoadingRemote,
                isSavingRemote,
                isPulling,
                isBusy,
                remoteConfigView,
                onRemoteConfigViewChange: (view) => useRemoteDraftStore.getState().setView(view),
                remoteDraft,
                remoteProviderIds,
                selectedRemoteProviderId,
                selectedRemoteProvider,
                remoteModelIds,
                selectedRemoteModelId,
                selectedRemoteModel,
                defaultProvider,
                defaultProviderModelIds,
                remoteModelReferenceOptions,
                remoteYamlPreview,
                onSelectRemoteProvider: handleSelectRemoteProvider,
                onAddRemoteProvider: handleAddRemoteProvider,
                onRemoveRemoteProvider: handleRemoveRemoteProvider,
                onRemoteProviderIdChange: handleRemoteProviderIdChange,
                onUpdateRemoteProvider: updateRemoteProvider,
                onSelectRemoteModel: handleSelectRemoteModel,
                onAddRemoteModel: handleAddRemoteModel,
                onRemoveRemoteModel: handleRemoveRemoteModel,
                onRemoteModelIdChange: handleRemoteModelIdChange,
                onUpdateRemoteModel: updateRemoteModel,
                onDefaultRemoteProviderChange: handleDefaultRemoteProviderChange,
                onDefaultRemoteModelChange: handleDefaultRemoteModelChange,
                onOhMyOpenAgentModelChange: handleOhMyOpenAgentModelChange,
                onOhMyOpenAgentVariantChange: handleOhMyOpenAgentVariantChange,
                onClearOhMyOpenAgentAssignment: handleClearOhMyOpenAgentAssignment,
              }}
            />
          )}

          {activeTab === 'sync' && (
            <SyncTargetsPanel
              execute={{
                runtimeState,
                loadErrorNode,
                targetMode,
                onTargetModeChange: setTargetMode,
                configPath,
                onConfigPathChange: setConfigPath,
                requestStatePath,
                onPlan: handlePlan,
                canReview,
                isPlanning,
                confirmationText,
                onConfirmationTextChange: setConfirmationText,
                isPlanCurrent,
                canApply,
                isApplying,
                onApply: handleApply,
                planResponse,
                applyResults,
              }}
              localConfig={{
                runtimeState,
                loadErrorNode,
                targetMode,
                onTargetModeChange: setTargetMode,
                configAgent,
                configAvailabilityByAgent,
                isLoadingConfigAvailability,
                selectedConfigAvailability,
                configFile,
                configPathModeLabel,
                configPath,
                onConfigPathChange: setConfigPath,
                configDraft,
                onConfigDraftChange: setConfigDraft,
                configStatus,
                onLoadConfigFile: handleLoadConfigFile,
                onSaveConfigFile: handleSaveConfigFile,
                canLoadConfig,
                canSaveConfig,
                isLoadingConfig,
                isSavingConfig,
                localSyncTargetLabel,
                onPlan: handlePlan,
                canReviewLocalConfig,
                isPlanning,
                confirmationText,
                onConfirmationTextChange: setConfirmationText,
                canConfirmLocalConfig,
                canApplyLocalConfig,
                isApplying,
                onApply: handleApply,
                planResponse,
                isPlanCurrent,
                applyResults,
              }}
              rulesPanelNode={
                <RulesPanel
                  runtimeState={runtimeState}
                  requestStatePath={requestStatePath}
                  buildGitHubTokenRequest={() => buildGitHubTokenRequest()}
                  onState={commitRuntimeState}
                  onNotice={showNotice}
                />
              }
              skillsPanelNode={
                <section className="dashboard-grid dashboard-grid--rules" id="skills-panel" role="tabpanel" aria-labelledby="skills-tab">
                  <SkillsDirectoryPanel
                    requestStatePath={requestStatePath}
                    buildGitHubTokenRequest={() => buildGitHubTokenRequest()}
                    onState={commitRuntimeState}
                    onNotice={showNotice}
                  />
                </section>
              }
            />
          )}

          {activeTab === 'automation' && (
            <SyncPanel
              runtimeState={runtimeState}
              requestStatePath={requestStatePath}
              buildGitHubTokenRequest={() => buildGitHubTokenRequest()}
              onState={commitRuntimeState}
              onNotice={showNotice}
            />
          )}
        </section>
    </CommandCenterShell>
  );
}

export default App;
