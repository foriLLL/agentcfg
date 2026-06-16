import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ADAPTER_NAMES, getAdapter, type AdapterName } from '../adapters';
import { isAdapterName, resolveAdapterConfigPath } from '../adapters/registry';
import {
  atomicWriteFile,
  createSecretAgentConfigGist,
  detectNativeConfigFormat,
  discoverAgentConfigGist,
  fetchGistAgentConfig,
  GistError,
  NativeConfigParseError,
  parseNativeConfig,
  parseCanonicalAgentConfig,
  readLocalState,
  readSecrets,
  resolveStatePath,
  saveGitHubToken,
  serializeCanonicalAgentConfig,
  StateError,
  STATE_SCHEMA_VERSION,
  storeGistIdentity,
  clearSavedGitHubToken,
  defaultAutoSyncTargets,
  getManagedRuleFileStatuses,
  isNodeErrorWithCode,
  loadManagedRuleFilesFromGist,
  planManagedRuleFileApply,
  applyManagedRuleFilePlans,
  getSyncServiceStatus,
  installSyncService,
  updatePulledConfig,
  updateAutoSyncConfig,
  uploadManagedRuleFileFromLocal,
  updateGistAgentConfig,
  runSyncOnce,
  uninstallSyncService,
  validateAgentConfig,
  writeLocalState,
  type AgentConfigValidationError,
  type AgentDiffResult,
  type AgentConfigInput,
  type CanonicalAgentConfig,
  type FetchGistOptions,
  type ManagedRuleFileError,
} from '../core';
import {
  ApplyValidationError,
  applyPlan,
  planApply,
  plansToResults,
  type ApplyAgentPlan,
  type ApplyWriteOptions,
} from '../core/apply';
import { DiffError } from '../core/diff';
import type { AgentCfgState } from '../core/state';
import type {
  ApiApplyFilePreview,
  ApiApplyPlanSummary,
  ApplyRuntimeRequest,
  ApplyRuntimeResponse,
  ConfigAssociatedFile,
  ClearSavedGitHubTokenRuntimeRequest,
  ClearSavedGitHubTokenRuntimeResponse,
  ConfigAvailabilityEntry,
  ConfigAvailabilityRuntimeRequest,
  ConfigAvailabilityRuntimeResponse,
  ConfigFileRuntimeRequest,
  ConfigFileRuntimeResponse,
  DiffRuntimeRequest,
  DiffRuntimeResponse,
  DiscoverProviderModelsRuntimeRequest,
  DiscoverProviderModelsRuntimeResponse,
  GetRuntimeStateRequest,
  GetRuntimeStateResponse,
  InitRuntimeRequest,
  InitRuntimeResponse,
  ManagedRuleFilesApplyRuntimeResponse,
  ManagedRuleFilesPlanRuntimeResponse,
  ManagedRuleFilesRemoteRuntimeResponse,
  ManagedRuleFilesRuntimeRequest,
  ManagedRuleFilesStatusRuntimeResponse,
  PlanApplyRuntimeRequest,
  PlanApplyRuntimeResponse,
  PullRuntimeRequest,
  PullRuntimeResponse,
  SaveRemoteConfigRuntimeRequest,
  SaveRemoteConfigRuntimeResponse,
  SetupRemoteConfigRuntimeRequest,
  SetupRemoteConfigRuntimeResponse,
  LoadRemoteConfigRuntimeRequest,
  LoadRemoteConfigRuntimeResponse,
  RuntimeApiErrorCode,
  RuntimeApiErrorDetails,
  RuntimeStateSummary,
  SaveConfigFileRuntimeRequest,
  SaveConfigFileRuntimeResponse,
  AutoSyncRuntimeRequest,
  AutoSyncRuntimeResponse,
  SyncNowRuntimeResponse,
  SyncServiceRuntimeRequest,
  SyncServiceRuntimeResponse,
} from './types';

export type RuntimeServiceOptions = {
  gistOptions?: FetchGistOptions;
  applyWriteOptions?: ApplyWriteOptions;
  providerHttpClient?: ProviderModelDiscoveryHttpClient;
};

export type ProviderModelDiscoveryHttpResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
};

export type ProviderModelDiscoveryHttpClient = (
  url: string,
  options: { method: 'GET'; headers: Record<string, string> },
) => Promise<ProviderModelDiscoveryHttpResponse>;

export class RuntimeApiError extends Error {
  readonly code: RuntimeApiErrorCode;
  readonly details?: RuntimeApiErrorDetails;

  constructor(code: RuntimeApiErrorCode, message: string, details?: RuntimeApiErrorDetails) {
    super(message);
    this.name = 'RuntimeApiError';
    this.code = code;
    this.details = details;
  }
}

export async function getRuntimeState(request: GetRuntimeStateRequest = {}): Promise<GetRuntimeStateResponse> {
  try {
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath) };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function initRuntime(request: InitRuntimeRequest): Promise<InitRuntimeResponse> {
  try {
    const state = await storeGistIdentity(request.gistId, request.statePath);
    return { state: await summarizeState(state, request.statePath) };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function pullRuntime(
  request: PullRuntimeRequest = {},
  options: RuntimeServiceOptions = {},
): Promise<PullRuntimeResponse> {
  try {
    const existingState = await readLocalState(request.statePath);
    if (existingState.gist === undefined) {
      throw new RuntimeApiError('state-error', 'Run agentcfg init --gist <gist-id> before pull');
    }

    const token = await resolveGitHubToken(request);
    const fetched = await fetchGistAgentConfig(existingState.gist.id, withRequestToken(options.gistOptions, token));
    await rememberGitHubTokenIfRequested(request, token);
    const config = parseCanonicalAgentConfig(fetched.content);
    const state = await updatePulledConfig(request.statePath, config, fetched.metadata);

    return {
      state: await summarizeState(state, request.statePath),
      config,
      remote: state.remote,
    };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function setupRemoteConfigRuntime(
  request: SetupRemoteConfigRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<SetupRemoteConfigRuntimeResponse> {
  try {
    const token = await resolveRequiredGitHubToken(request);
    const gistOptions = withRequiredRequestToken(options.gistOptions, token);
    const discovered = await discoverAgentConfigGist(gistOptions);
    if (discovered === undefined) {
      await rememberGitHubTokenIfRequested(request, token);
      return { state: await summarizeState(await readLocalState(request.statePath), request.statePath) };
    }

    await storeGistIdentity(discovered.id, request.statePath);
    try {
      const fetched = await fetchGistAgentConfig(discovered.id, gistOptions);
      const config = parseCanonicalAgentConfig(fetched.content);
      const state = await updatePulledConfig(request.statePath, config, fetched.metadata);
      await rememberGitHubTokenIfRequested(request, token);
      return { state: await summarizeState(state, request.statePath), config, remote: state.remote };
    } catch (error) {
      if (isAgentConfigValidationError(error)) {
        await rememberGitHubTokenIfRequested(request, token);
        return { state: await summarizeState(await readLocalState(request.statePath), request.statePath) };
      }
      throw error;
    }
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function loadRemoteConfigRuntime(
  request: LoadRemoteConfigRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<LoadRemoteConfigRuntimeResponse> {
  try {
    const existingState = await readLocalState(request.statePath);
    if (existingState.gist === undefined) {
      throw new RuntimeApiError('state-error', 'Run remote setup or save before loading remote config.');
    }

    const token = await resolveRequiredGitHubToken(request);
    const fetched = await fetchGistAgentConfig(existingState.gist.id, withRequiredRequestToken(options.gistOptions, token));
    const config = parseCanonicalAgentConfig(fetched.content);
    const state = await updatePulledConfig(request.statePath, config, fetched.metadata);
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(state, request.statePath), config, remote: state.remote };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function saveRemoteConfigRuntime(
  request: SaveRemoteConfigRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<SaveRemoteConfigRuntimeResponse> {
  try {
    const token = await resolveRequiredGitHubToken(request);
    const gistOptions = withRequiredRequestToken(options.gistOptions, token);
    if (request.config === undefined) {
      throw new RuntimeApiError('invalid-request', 'config is required.');
    }

    const existingState = await readLocalState(request.statePath);
    const config = await resolveRemoteConfigForSave(request.config, existingState.gist?.id, gistOptions);
    const content = serializeCanonicalAgentConfig(config);
    const saved =
      existingState.gist === undefined
        ? await createSecretAgentConfigGist(content, gistOptions)
        : await updateGistAgentConfig(existingState.gist.id, content, gistOptions);
    const state = await writeRemoteConfigState(request.statePath, saved.id, config, saved.metadata);

    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(state, request.statePath), config, remote: state.remote };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function clearSavedGitHubTokenRuntime(
  request: ClearSavedGitHubTokenRuntimeRequest = {},
): Promise<ClearSavedGitHubTokenRuntimeResponse> {
  try {
    await clearSavedGitHubToken(request.statePath);
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath) };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function discoverProviderModelsRuntime(
  request: DiscoverProviderModelsRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<DiscoverProviderModelsRuntimeResponse> {
  try {
    const providerId = requireProviderId(request.provider);
    const state = await readLocalState(request.statePath);
    if (state.cache === undefined) {
      throw new RuntimeApiError('state-error', 'No cached agentcfg.yaml found. Run agentcfg pull before discovering provider models.');
    }

    const provider = state.cache.config.providers[providerId];
    if (provider === undefined) {
      throw new RuntimeApiError('invalid-request', `Provider ${providerId} is not configured.`);
    }
    if (provider.modelDiscovery === undefined) {
      throw new RuntimeApiError('invalid-request', `Provider ${providerId} model discovery is not configured.`);
    }

    const response = await requestProviderModels(
      buildProviderModelDiscoveryUrl(provider.baseURL, provider.modelDiscovery.path),
      provider.apiKey.value,
      options.providerHttpClient ?? defaultProviderModelDiscoveryHttpClient,
    );

    if (!response.ok) {
      throw new RuntimeApiError('provider-error', formatProviderHttpError(response));
    }

    const body = await readProviderModelsJson(response, providerId);
    return { provider: providerId, models: extractProviderModelIds(body, providerId) };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function diffRuntime(request: DiffRuntimeRequest): Promise<DiffRuntimeResponse> {
  try {
    const selectedAgents = selectAgents(request);
    const state = await readLocalState(request.statePath);
    if (state.cache === undefined) {
      throw new RuntimeApiError('state-error', 'No cached agentcfg.yaml found. Run agentcfg pull before diff.');
    }

    const results: AgentDiffResult[] = [];
    for (const agent of selectedAgents) {
      results.push(
        await getAdapter(agent).diff(state.cache.config, {
          configPath: request.configPath,
          fixturesRoot: request.fixturesRoot,
        }),
      );
    }

    return {
      results: results.map((result) => ({
        agent: result.agent as AdapterName,
        changes: result.changes,
        notices: result.notices,
      })),
    };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function planApplyRuntime(request: PlanApplyRuntimeRequest): Promise<PlanApplyRuntimeResponse> {
  try {
    const plans = await buildApplyPlans(request, 'apply');
    return {
      plans: await summarizePlans(plans),
      results: plansToResults(plans, 'would-change'),
    };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function applyRuntime(
  request: ApplyRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<ApplyRuntimeResponse> {
  try {
    if (request.confirm !== 'APPLY') {
      throw new RuntimeApiError('invalid-request', 'Apply requires confirm: "APPLY".');
    }

    const plans = await buildApplyPlans(request, 'apply');
    return { results: await applyPlan(plans, options.applyWriteOptions) };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function getConfigFileRuntime(request: ConfigFileRuntimeRequest): Promise<ConfigFileRuntimeResponse> {
  try {
    const agent = requireSingleAgent(request.agent);
    const configPath = await resolveConfigEditorPath(agent, request);
    const fileStat = await stat(configPath).catch((error: unknown) => {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        throw new RuntimeApiError(
          'invalid-request',
          `Missing ${agent} native config at ${configPath}. Enter an existing config path or create the file before loading.`,
        );
      }
      throw error;
    });
    const format = detectNativeConfigFormat(configPath);

    return {
      agent,
      path: configPath,
      format,
      content: await readFile(configPath, 'utf8'),
      updatedAt: fileStat.mtime.toISOString(),
    };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function getConfigAvailabilityRuntime(
  request: ConfigAvailabilityRuntimeRequest = {},
): Promise<ConfigAvailabilityRuntimeResponse> {
  const agents: ConfigAvailabilityEntry[] = [];

  for (const agent of ADAPTER_NAMES) {
    try {
      const configPath = await resolveConfigEditorPath(agent, { ...request, agent });
      const fileStat = await stat(configPath);
      const format = detectNativeConfigFormat(configPath);
      agents.push({
        agent,
        available: true,
        status: 'available',
        path: configPath,
        format,
        updatedAt: fileStat.mtime.toISOString(),
        files: await buildConfigAssociatedFiles(agent, configPath),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unable to resolve native config.';
      agents.push({
        agent,
        available: false,
        status: reason.startsWith('Ambiguous') ? 'ambiguous' : 'missing',
        files: await buildMissingConfigAssociatedFiles(agent, request),
        reason,
      });
    }
  }

  return { agents };
}

async function buildConfigAssociatedFiles(agent: AdapterName, configPath: string): Promise<ConfigAssociatedFile[]> {
  const files = [await describeAssociatedFile('primary', '主配置', configPath, detectNativeConfigFormat(configPath))];

  if (agent === 'codex') {
    files.push(await describeAssociatedFile('generated-env', 'API Key 环境变量', join(homedir(), '.codex', '.env'), 'env'));
  }

  return files;
}

async function buildMissingConfigAssociatedFiles(
  agent: AdapterName,
  request: ConfigAvailabilityRuntimeRequest,
): Promise<ConfigAssociatedFile[]> {
  const configPath = request.configPath?.trim() === '' || request.configPath === undefined ? getAdapter(agent).defaultConfigPath() : request.configPath;
  const files = [await describeAssociatedFile('primary', '主配置', configPath, safeDetectNativeConfigFormat(configPath))];

  if (agent === 'codex') {
    files.push(await describeAssociatedFile('generated-env', 'API Key 环境变量', join(homedir(), '.codex', '.env'), 'env'));
  }

  return files;
}

async function describeAssociatedFile(
  role: ConfigAssociatedFile['role'],
  label: string,
  path: string,
  format?: ConfigAssociatedFile['format'],
): Promise<ConfigAssociatedFile> {
  const fileStat = await stat(path).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  });

  return {
    role,
    label,
    path,
    exists: fileStat !== undefined,
    ...(format === undefined ? {} : { format }),
    ...(fileStat === undefined ? {} : { updatedAt: fileStat.mtime.toISOString() }),
  };
}

function safeDetectNativeConfigFormat(path: string): ConfigAssociatedFile['format'] | undefined {
  try {
    return detectNativeConfigFormat(path);
  } catch (error) {
    if (error instanceof NativeConfigParseError) {
      return undefined;
    }
    throw error;
  }
}

export async function saveConfigFileRuntime(request: SaveConfigFileRuntimeRequest): Promise<SaveConfigFileRuntimeResponse> {
  try {
    const agent = requireSingleAgent(request.agent);
    if (typeof request.content !== 'string') {
      throw new RuntimeApiError('invalid-request', 'content must be a string.');
    }

    const configPath = await resolveConfigEditorPath(agent, request);
    const format = detectNativeConfigFormat(configPath);
    parseNativeConfig(request.content, format);
    const existingStat = await stat(configPath).catch(() => undefined);
    const result = await atomicWriteFile(configPath, request.content, {
      mode: existingStat === undefined ? undefined : existingStat.mode & 0o777,
    });
    const fileStat = await stat(configPath);

    return {
      agent,
      path: configPath,
      format,
      content: await readFile(configPath, 'utf8'),
      updatedAt: fileStat.mtime.toISOString(),
      backupPath: result.backup?.backupPath,
    };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function getManagedRuleFilesRuntime(
  request: GetRuntimeStateRequest = {},
): Promise<ManagedRuleFilesStatusRuntimeResponse> {
  try {
    return {
      state: await summarizeState(await readLocalState(request.statePath), request.statePath),
      files: await getManagedRuleFileStatuses(),
    };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function loadManagedRuleFilesRuntime(
  request: ManagedRuleFilesRuntimeRequest = {},
  options: RuntimeServiceOptions = {},
): Promise<ManagedRuleFilesRemoteRuntimeResponse> {
  try {
    const state = await requireGistState(request.statePath);
    const token = await resolveRequiredGitHubToken(request);
    const files = await loadManagedRuleFilesFromGist(state.gist.id, withRequiredRequestToken(options.gistOptions, token));
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath), files };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function initializeManagedRuleFileRuntime(
  request: ManagedRuleFilesRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<ManagedRuleFilesRemoteRuntimeResponse> {
  try {
    const id = requireManagedRuleFileId(request.id);
    const state = await requireGistState(request.statePath);
    const token = await resolveRequiredGitHubToken(request);
    const file = await uploadManagedRuleFileFromLocal(
      state.gist.id,
      id,
      withRequiredRequestToken(options.gistOptions, token),
    );
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath), files: [file] };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function planManagedRuleFilesRuntime(
  request: ManagedRuleFilesRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<ManagedRuleFilesPlanRuntimeResponse> {
  try {
    const state = await requireGistState(request.statePath);
    const token = await resolveRequiredGitHubToken(request);
    const plans = await planManagedRuleFileApply(
      state.gist.id,
      normalizeManagedRuleFileIds(request),
      withRequiredRequestToken(options.gistOptions, token),
    );
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath), plans };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function applyManagedRuleFilesRuntime(
  request: ManagedRuleFilesRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<ManagedRuleFilesApplyRuntimeResponse> {
  try {
    if (request.confirm !== 'APPLY') {
      throw new RuntimeApiError('invalid-request', 'Rule file apply requires confirm: "APPLY".');
    }
    const state = await requireGistState(request.statePath);
    const token = await resolveRequiredGitHubToken(request);
    const plans = await planManagedRuleFileApply(
      state.gist.id,
      normalizeManagedRuleFileIds(request),
      withRequiredRequestToken(options.gistOptions, token),
    );
    const results = await applyManagedRuleFilePlans(plans, options.applyWriteOptions);
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath), results };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function saveAutoSyncRuntime(request: AutoSyncRuntimeRequest): Promise<AutoSyncRuntimeResponse> {
  try {
    if (request.autoSync === undefined) {
      throw new RuntimeApiError('invalid-request', 'autoSync is required.');
    }
    const state = await updateAutoSyncConfig(request.statePath, request.autoSync);
    return { state: await summarizeState(state, request.statePath) };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function syncNowRuntime(
  request: AutoSyncRuntimeRequest = {},
  options: RuntimeServiceOptions = {},
): Promise<SyncNowRuntimeResponse> {
  try {
    const token = await resolveGitHubToken(request);
    const result = await runSyncOnce({
      statePath: request.statePath,
      targets: request.targets,
      gistOptions: withRequestToken(options.gistOptions, token),
      applyWriteOptions: options.applyWriteOptions,
    });
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath), result };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function installSyncServiceRuntime(
  request: SyncServiceRuntimeRequest = {},
): Promise<SyncServiceRuntimeResponse> {
  try {
    const state = await readLocalState(request.statePath);
    const intervalMinutes = request.intervalMinutes ?? state.autoSync?.intervalMinutes ?? 60;
    const service = await installSyncService({ statePath: request.statePath, intervalMinutes });
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath), service };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function uninstallSyncServiceRuntime(
  request: SyncServiceRuntimeRequest = {},
): Promise<SyncServiceRuntimeResponse> {
  try {
    const service = await uninstallSyncService({ statePath: request.statePath });
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath), service };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function getSyncServiceRuntime(
  request: SyncServiceRuntimeRequest = {},
): Promise<SyncServiceRuntimeResponse> {
  try {
    const service = await getSyncServiceStatus();
    return { state: await summarizeState(await readLocalState(request.statePath), request.statePath), service };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

async function summarizeState(state: AgentCfgState, statePath?: string): Promise<RuntimeStateSummary> {
  return {
    statePath: resolveStatePath(statePath),
    schemaVersion: state.schemaVersion,
    secrets: {
      hasGitHubToken: (await readSecrets(statePath)).githubToken !== undefined,
    },
    gist: {
      present: state.gist !== undefined,
      id: state.gist?.id,
    },
    remote: state.remote,
    cache: {
      present: state.cache !== undefined,
      updatedAt: state.cache?.updatedAt,
      config: state.cache?.config,
    },
    conflict: {
      present: state.conflict !== undefined,
      baseRevision: state.conflict?.baseRevision,
      baseETag: state.conflict?.baseETag,
      baseConfig: state.conflict?.baseConfig,
    },
    autoSync: state.autoSync ?? {
      enabled: false,
      intervalMinutes: 60,
      targets: defaultAutoSyncTargets(),
    },
    lastSyncRun: state.lastSyncRun,
  };
}

async function requireGistState(statePath: string | undefined): Promise<AgentCfgState & { gist: { id: string } }> {
  const state = await readLocalState(statePath);
  if (state.gist === undefined) {
    throw new RuntimeApiError('state-error', 'Run remote setup or init before syncing rule files.');
  }
  return { ...state, gist: state.gist };
}

function requireManagedRuleFileId(id: string | undefined): string {
  if (id === undefined || id.trim() === '') {
    throw new RuntimeApiError('invalid-request', 'id is required.');
  }
  return id;
}

function normalizeManagedRuleFileIds(request: ManagedRuleFilesRuntimeRequest): string[] {
  if (request.id !== undefined && request.ids !== undefined) {
    throw new RuntimeApiError('invalid-request', 'Choose id or ids, not both.');
  }
  if (request.id !== undefined) {
    return [request.id];
  }
  if (request.ids === undefined) {
    return [];
  }
  if (!Array.isArray(request.ids) || !request.ids.every((id) => typeof id === 'string' && id.trim() !== '')) {
    throw new RuntimeApiError('invalid-request', 'ids must be an array of non-empty strings.');
  }
  return request.ids;
}

async function resolveConfigEditorPath(agent: AdapterName, request: ConfigFileRuntimeRequest): Promise<string> {
  try {
    return await resolveAdapterConfigPath(agent, {
      configPath: request.configPath,
      fixturesRoot: request.fixturesRoot,
    });
  } catch (error) {
    if (error instanceof DiffError) {
      throw new RuntimeApiError('invalid-request', error.message);
    }
    throw error;
  }
}

async function resolveGitHubToken(request: { githubToken?: string; statePath?: string }): Promise<string | undefined> {
  const requestToken = request.githubToken?.trim();
  if (requestToken !== undefined && requestToken !== '') {
    return requestToken;
  }
  return (await readSecrets(request.statePath)).githubToken;
}

async function resolveRequiredGitHubToken(request: { githubToken?: string; statePath?: string }): Promise<string> {
  const token = await resolveGitHubToken(request);
  if (token === undefined) {
    throw new RuntimeApiError('invalid-request', 'githubToken is required.');
  }
  return token;
}

async function rememberGitHubTokenIfRequested(
  request: { rememberGitHubToken?: boolean; githubToken?: string; statePath?: string },
  token: string | undefined,
): Promise<void> {
  if (request.rememberGitHubToken !== true || token === undefined) {
    return;
  }
  await saveGitHubToken(token, request.statePath);
}

function requireProviderId(provider: string | undefined): string {
  if (provider === undefined || provider.trim() === '') {
    throw new RuntimeApiError('invalid-request', 'provider is required.');
  }
  return provider;
}

async function requestProviderModels(
  url: string,
  apiKey: string,
  httpClient: ProviderModelDiscoveryHttpClient,
): Promise<ProviderModelDiscoveryHttpResponse> {
  try {
    return await httpClient(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'agentcfg',
      },
    });
  } catch {
    throw new RuntimeApiError('provider-error', 'Provider model discovery network request failed before receiving a response.');
  }
}

function buildProviderModelDiscoveryUrl(baseURL: string, path: string): string {
  return `${baseURL.replace(/\/+$/, '')}${path}`;
}

async function defaultProviderModelDiscoveryHttpClient(
  url: string,
  options: { method: 'GET'; headers: Record<string, string> },
): Promise<ProviderModelDiscoveryHttpResponse> {
  return fetch(url, { method: options.method, headers: options.headers });
}

function formatProviderHttpError(response: ProviderModelDiscoveryHttpResponse): string {
  const statusText = response.statusText.trim();
  return `Provider model discovery failed with ${response.status}${statusText === '' ? '' : ` ${statusText}`}.`;
}

async function readProviderModelsJson(response: ProviderModelDiscoveryHttpResponse, providerId: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new RuntimeApiError('provider-error', `Provider ${providerId} model discovery response was not valid JSON.`);
  }
}

function extractProviderModelIds(body: unknown, providerId: string): string[] {
  const entries = extractProviderModelEntries(body, providerId);
  return entries.map((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new RuntimeApiError(
        'provider-error',
        `Provider ${providerId} model discovery response must include model objects with non-empty string id values.`,
      );
    }
    return entry.id;
  });
}

function extractProviderModelEntries(body: unknown, providerId: string): unknown[] {
  if (!isRecord(body)) {
    throw unsupportedProviderModelsShape(providerId);
  }
  if (Array.isArray(body.data)) {
    return body.data;
  }
  if (Array.isArray(body.models)) {
    return body.models;
  }
  throw unsupportedProviderModelsShape(providerId);
}

function unsupportedProviderModelsShape(providerId: string): RuntimeApiError {
  return new RuntimeApiError(
    'provider-error',
    `Provider ${providerId} model discovery response must include a data or models array.`,
  );
}

function withRequestToken(gistOptions: FetchGistOptions | undefined, githubToken: string | undefined): FetchGistOptions | undefined {
  if (githubToken === undefined) {
    return gistOptions;
  }
  return { ...gistOptions, token: githubToken };
}

function withRequiredRequestToken(gistOptions: FetchGistOptions | undefined, githubToken: string | undefined): FetchGistOptions {
  if (githubToken === undefined || githubToken.trim() === '') {
    throw new RuntimeApiError('invalid-request', 'githubToken is required.');
  }
  return { ...gistOptions, token: githubToken };
}

async function resolveRemoteConfigForSave(
  configInput: AgentConfigInput,
  _gistId: string | undefined,
  _gistOptions: FetchGistOptions,
): Promise<CanonicalAgentConfig> {
  return validateAgentConfig(configInput);
}

async function writeRemoteConfigState(
  statePath: string | undefined,
  gistId: string,
  config: CanonicalAgentConfig,
  metadata: { revision?: string; etag?: string },
): Promise<AgentCfgState> {
  const updatedAt = new Date().toISOString();
  const existingState = await readLocalState(statePath);
  const state: AgentCfgState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    gist: { id: gistId },
    remote: omitUndefined({ revision: metadata.revision, etag: metadata.etag, pulledAt: updatedAt }),
    cache: { config, updatedAt },
    conflict: omitUndefined({ baseConfig: config, baseRevision: metadata.revision, baseETag: metadata.etag }),
    autoSync: existingState.autoSync,
    lastSyncRun: existingState.lastSyncRun,
  };
  await writeLocalState(state, statePath);
  return state;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue !== undefined) {
      result[key] = entryValue;
    }
  }
  return result as T;
}

async function buildApplyPlans(request: PlanApplyRuntimeRequest, action: 'apply'): Promise<ApplyAgentPlan[]> {
  const selectedAgents = selectAgents(request);
  const state = await readLocalState(request.statePath);
  if (state.cache === undefined) {
    throw new RuntimeApiError('state-error', `No cached agentcfg.yaml found. Run agentcfg pull before ${action}.`);
  }

  try {
    return await planApply(state.cache.config, selectedAgents, {
      configPath: request.configPath,
      fixturesRoot: request.fixturesRoot,
    });
  } catch (error) {
    if (error instanceof ApplyValidationError) {
      throw new RuntimeApiError('apply-error', 'Apply validation failed; no files were written.', {
        results: error.results,
      });
    }
    throw error;
  }
}

function selectAgents(request: { agent?: AdapterName; allAgents?: boolean }): AdapterName[] {
  if (request.agent !== undefined && request.allAgents === true) {
    throw new RuntimeApiError(
      'invalid-request',
      `Choose exactly one target selector: agent <${ADAPTER_NAMES.join('|')}> or allAgents.`,
    );
  }

  if (request.agent === undefined && request.allAgents !== true) {
    throw new RuntimeApiError(
      'invalid-request',
      `Choose exactly one target selector: agent <${ADAPTER_NAMES.join('|')}> or allAgents.`,
    );
  }

  return request.agent === undefined ? [...ADAPTER_NAMES] : [request.agent];
}

function requireSingleAgent(agent: string | undefined): AdapterName {
  if (agent === undefined) {
    throw new RuntimeApiError('invalid-request', `Choose exactly one agent: ${ADAPTER_NAMES.join(', ')}.`);
  }
  if (!isAdapterName(agent)) {
    throw new RuntimeApiError('invalid-request', `agent must be one of ${ADAPTER_NAMES.join(', ')}.`);
  }
  return agent;
}

async function summarizePlans(plans: ApplyAgentPlan[]): Promise<ApiApplyPlanSummary[]> {
  return Promise.all(plans.map(async (plan) => ({
    agent: plan.agent,
    configPath: plan.configPath,
    envPath: plan.envPath,
    changes: plan.changes,
    notices: plan.notices,
    operationCount: plan.operations.length,
    operationPaths: plan.operations.map((operation) => operation.path),
    filePreviews: await Promise.all(plan.operations.map(operationToFilePreview)),
  })));
}

async function operationToFilePreview(operation: ApplyAgentPlan['operations'][number]): Promise<ApiApplyFilePreview> {
  return {
    path: operation.path,
    kind: operation.kind,
    mode: operation.mode,
    currentContent: await readOptionalFile(operation.path),
    expectedContent: operation.content,
  };
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

function toRuntimeApiError(error: unknown): RuntimeApiError {
  if (error instanceof RuntimeApiError) {
    return error;
  }
  if (error instanceof StateError) {
    return new RuntimeApiError('state-error', error.message);
  }
  if (error instanceof GistError) {
    return new RuntimeApiError('gist-error', error.message);
  }
  if (isAgentConfigValidationError(error)) {
    return new RuntimeApiError('validation-error', error.message);
  }
  if (error instanceof NativeConfigParseError) {
    return new RuntimeApiError('validation-error', error.message);
  }
  if (error instanceof DiffError) {
    return new RuntimeApiError('diff-error', error.message);
  }
  if (error instanceof ApplyValidationError) {
    return new RuntimeApiError('apply-error', 'Apply validation failed; no files were written.', {
      results: error.results,
    });
  }
  if (isManagedRuleFileError(error)) {
    return new RuntimeApiError('apply-error', error.message);
  }
  if (error instanceof Error) {
    return new RuntimeApiError('apply-error', error.message);
  }
  return new RuntimeApiError('apply-error', String(error));
}

function isAgentConfigValidationError(error: unknown): error is AgentConfigValidationError {
  return error instanceof Error && error.name === 'AgentConfigValidationError';
}

function isManagedRuleFileError(error: unknown): error is ManagedRuleFileError {
  return error instanceof Error && error.name === 'ManagedRuleFileError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
