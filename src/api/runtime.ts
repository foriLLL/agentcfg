import { readFile, stat } from 'node:fs/promises';
import { ADAPTER_NAMES, getAdapter, type AdapterName } from '../adapters';
import { isAdapterName, resolveAdapterConfigPath } from '../adapters/registry';
import {
  atomicWriteFile,
  createSecretAgentConfigGist,
  detectNativeConfigFormat,
  discoverAgentConfigGist,
  fetchGistAgentConfig,
  GistError,
  maskConfig,
  MASKED_SECRET,
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
  updatePulledConfig,
  updateGistAgentConfig,
  validateAgentConfig,
  writeLocalState,
  type AgentConfigValidationError,
  type AgentDiffResult,
  type AgentConfigInput,
  type CanonicalAgentConfig,
  type FetchGistOptions,
  type ManagedDiffChange,
} from '../core';
import {
  ApplyValidationError,
  applyPlan,
  planApply,
  plansToResults,
  type ApplyAgentPlan,
  type ApplyAgentResult,
  type ApplyWriteOptions,
} from '../core/apply';
import { DiffError } from '../core/diff';
import type { AgentCfgState } from '../core/state';
import type {
  ApiAgentDiffResult,
  ApiApplyAgentResult,
  ApiApplyFilePreview,
  ApiApplyPlanSummary,
  ApplyRuntimeRequest,
  ApplyRuntimeResponse,
  ClearSavedGitHubTokenRuntimeRequest,
  ClearSavedGitHubTokenRuntimeResponse,
  ConfigFileRuntimeRequest,
  ConfigFileRuntimeResponse,
  DiffRuntimeRequest,
  DiffRuntimeResponse,
  GetRuntimeStateRequest,
  GetRuntimeStateResponse,
  InitRuntimeRequest,
  InitRuntimeResponse,
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
} from './types';

export type RuntimeServiceOptions = {
  gistOptions?: FetchGistOptions;
  applyWriteOptions?: ApplyWriteOptions;
};

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
      config: maskConfig(config),
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
      return { state: await summarizeState(state, request.statePath), config: maskConfig(config), remote: state.remote };
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
    return { state: await summarizeState(state, request.statePath), config: maskConfig(config), remote: state.remote };
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
    return { state: await summarizeState(state, request.statePath), config: maskConfig(config), remote: state.remote };
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

    return { results: maskDiffResults(results) };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function planApplyRuntime(request: PlanApplyRuntimeRequest): Promise<PlanApplyRuntimeResponse> {
  try {
    const plans = await buildApplyPlans(request, 'apply');
    return {
      plans: await summarizePlans(plans),
      results: maskApplyResults(plansToResults(plans, 'would-change')),
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
    return { results: maskApplyResults(await applyPlan(plans, options.applyWriteOptions)) };
  } catch (error) {
    throw toRuntimeApiError(error);
  }
}

export async function getConfigFileRuntime(request: ConfigFileRuntimeRequest): Promise<ConfigFileRuntimeResponse> {
  try {
    const agent = requireSingleAgent(request.agent);
    const configPath = await resolveAdapterConfigPath(agent, {
      configPath: request.configPath,
      fixturesRoot: request.fixturesRoot,
    });
    const fileStat = await stat(configPath);
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

export async function saveConfigFileRuntime(request: SaveConfigFileRuntimeRequest): Promise<SaveConfigFileRuntimeResponse> {
  try {
    const agent = requireSingleAgent(request.agent);
    if (typeof request.content !== 'string') {
      throw new RuntimeApiError('invalid-request', 'content must be a string.');
    }

    const configPath = await resolveAdapterConfigPath(agent, {
      configPath: request.configPath,
      fixturesRoot: request.fixturesRoot,
    });
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
      config: state.cache === undefined ? undefined : maskConfig(state.cache.config),
    },
    conflict: {
      present: state.conflict !== undefined,
      baseRevision: state.conflict?.baseRevision,
      baseETag: state.conflict?.baseETag,
      baseConfig: state.conflict === undefined ? undefined : maskConfig(state.conflict.baseConfig),
    },
  };
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
  gistId: string | undefined,
  gistOptions: FetchGistOptions,
): Promise<CanonicalAgentConfig> {
  if (!shouldPreserveRemoteApiKey(configInput)) {
    return validateAgentConfig(configInput);
  }

  if (gistId === undefined) {
    return validateAgentConfig(configInput);
  }

  const existingRemote = parseCanonicalAgentConfig((await fetchGistAgentConfig(gistId, gistOptions)).content);
  return validateAgentConfig({ ...configInput, apiKey: existingRemote.apiKey });
}

async function writeRemoteConfigState(
  statePath: string | undefined,
  gistId: string,
  config: CanonicalAgentConfig,
  metadata: { revision?: string; etag?: string },
): Promise<AgentCfgState> {
  const updatedAt = new Date().toISOString();
  const state: AgentCfgState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    gist: { id: gistId },
    remote: omitUndefined({ revision: metadata.revision, etag: metadata.etag, pulledAt: updatedAt }),
    cache: { config, updatedAt },
    conflict: omitUndefined({ baseConfig: config, baseRevision: metadata.revision, baseETag: metadata.etag }),
  };
  await writeLocalState(state, statePath);
  return state;
}

function shouldPreserveRemoteApiKey(configInput: AgentConfigInput): boolean {
  const apiKey = configInput.apiKey;
  if (apiKey === undefined) {
    return true;
  }
  if (typeof apiKey === 'string') {
    return apiKey.trim() === '';
  }
  if (typeof apiKey === 'object' && apiKey !== null && !Array.isArray(apiKey) && 'value' in apiKey) {
    return typeof apiKey.value === 'string' && apiKey.value.trim() === '';
  }
  return false;
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
        results: maskApplyResults(error.results),
      });
    }
    throw error;
  }
}

function selectAgents(request: { agent?: AdapterName; allAgents?: boolean }): AdapterName[] {
  if (request.agent !== undefined && request.allAgents === true) {
    throw new RuntimeApiError(
      'invalid-request',
      'Choose exactly one target selector: agent <codex|opencode|openclaw> or allAgents.',
    );
  }

  if (request.agent === undefined && request.allAgents !== true) {
    throw new RuntimeApiError(
      'invalid-request',
      'Choose exactly one target selector: agent <codex|opencode|openclaw> or allAgents.',
    );
  }

  return request.agent === undefined ? [...ADAPTER_NAMES] : [request.agent];
}

function requireSingleAgent(agent: string | undefined): AdapterName {
  if (agent === undefined) {
    throw new RuntimeApiError('invalid-request', 'Choose exactly one agent: codex, opencode, or openclaw.');
  }
  if (!isAdapterName(agent)) {
    throw new RuntimeApiError('invalid-request', 'agent must be one of codex, opencode, or openclaw.');
  }
  return agent;
}

async function summarizePlans(plans: ApplyAgentPlan[]): Promise<ApiApplyPlanSummary[]> {
  return Promise.all(plans.map(async (plan) => ({
    agent: plan.agent,
    configPath: plan.configPath,
    envPath: plan.envPath,
    changes: maskChanges(plan.changes),
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

function maskDiffResults(results: AgentDiffResult[]): ApiAgentDiffResult[] {
  return results.map((result) => ({
    agent: result.agent as AdapterName,
    changes: maskChanges(result.changes),
  }));
}

function maskApplyResults(results: ApplyAgentResult[]): ApiApplyAgentResult[] {
  return results.map((result) => ({
    ...result,
    changes: maskChanges(result.changes),
  }));
}

function maskChanges(changes: ManagedDiffChange[]): ManagedDiffChange[] {
  return changes.map((change) => ({
    ...change,
    current: change.secret ? maskOptionalValue(change.current) : change.current,
    expected: change.secret ? maskOptionalValue(change.expected) : change.expected,
  }));
}

function maskOptionalValue(value: string | undefined): string | undefined {
  return value === undefined ? undefined : MASKED_SECRET;
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
      results: maskApplyResults(error.results),
    });
  }
  if (error instanceof Error) {
    return new RuntimeApiError('apply-error', error.message);
  }
  return new RuntimeApiError('apply-error', String(error));
}

function isAgentConfigValidationError(error: unknown): error is AgentConfigValidationError {
  return error instanceof Error && error.name === 'AgentConfigValidationError';
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code;
}
