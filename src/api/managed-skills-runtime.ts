import {
  GistError,
  ManagedAgentSkillsError,
  StateError,
  applyManagedAgentSkillsPlan,
  getManagedAgentSkillsStatus,
  loadManagedAgentSkillsFromGist,
  planManagedAgentSkillsApply,
  readLocalState,
  readSecrets,
  saveGitHubToken,
  uploadManagedAgentSkillsFromLocal,
  type FetchGistOptions,
  type ManagedAgentSkillsApplyResult,
  type ManagedAgentSkillsPlan,
  type ManagedAgentSkillsRemote,
  type ManagedAgentSkillsStatus,
} from '../core';
import { RuntimeApiError, getRuntimeState, type RuntimeServiceOptions } from './runtime';
import type { RuntimeRequest, RuntimeStateSummary } from './types';

export type ManagedAgentSkillsRuntimeRequest = RuntimeRequest & {
  githubToken?: string;
  rememberGitHubToken?: boolean;
  confirm?: 'APPLY' | string;
};

export type ManagedAgentSkillsStatusRuntimeResponse = {
  state: RuntimeStateSummary;
  skills: ManagedAgentSkillsStatus;
};

export type ManagedAgentSkillsRemoteRuntimeResponse = {
  state: RuntimeStateSummary;
  skills: ManagedAgentSkillsRemote;
};

export type ManagedAgentSkillsPlanRuntimeResponse = {
  state: RuntimeStateSummary;
  plan: ManagedAgentSkillsPlan;
};

export type ManagedAgentSkillsApplyRuntimeResponse = {
  state: RuntimeStateSummary;
  result: ManagedAgentSkillsApplyResult;
};

export async function getManagedAgentSkillsRuntime(
  request: RuntimeRequest = {},
): Promise<ManagedAgentSkillsStatusRuntimeResponse> {
  try {
    return { state: await summarizeState(request.statePath), skills: await getManagedAgentSkillsStatus() };
  } catch (error) {
    throw toManagedAgentSkillsRuntimeError(error);
  }
}

export async function loadManagedAgentSkillsRuntime(
  request: ManagedAgentSkillsRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<ManagedAgentSkillsRemoteRuntimeResponse> {
  try {
    const state = await requireGistState(request.statePath);
    const token = await resolveRequiredGitHubToken(request);
    const skills = await loadManagedAgentSkillsFromGist(state.gist.id, withRequiredRequestToken(options.gistOptions, token));
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(request.statePath), skills };
  } catch (error) {
    throw toManagedAgentSkillsRuntimeError(error);
  }
}

export async function initializeManagedAgentSkillsRuntime(
  request: ManagedAgentSkillsRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<ManagedAgentSkillsRemoteRuntimeResponse> {
  try {
    const state = await requireGistState(request.statePath);
    const token = await resolveRequiredGitHubToken(request);
    const skills = await uploadManagedAgentSkillsFromLocal(state.gist.id, withRequiredRequestToken(options.gistOptions, token));
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(request.statePath), skills };
  } catch (error) {
    throw toManagedAgentSkillsRuntimeError(error);
  }
}

export async function planManagedAgentSkillsRuntime(
  request: ManagedAgentSkillsRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<ManagedAgentSkillsPlanRuntimeResponse> {
  try {
    const state = await requireGistState(request.statePath);
    const token = await resolveRequiredGitHubToken(request);
    const plan = await planManagedAgentSkillsApply(state.gist.id, withRequiredRequestToken(options.gistOptions, token));
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(request.statePath), plan };
  } catch (error) {
    throw toManagedAgentSkillsRuntimeError(error);
  }
}

export async function applyManagedAgentSkillsRuntime(
  request: ManagedAgentSkillsRuntimeRequest,
  options: RuntimeServiceOptions = {},
): Promise<ManagedAgentSkillsApplyRuntimeResponse> {
  try {
    if (request.confirm !== 'APPLY') {
      throw new RuntimeApiError('invalid-request', 'Agent skills apply requires confirm: "APPLY".');
    }
    const state = await requireGistState(request.statePath);
    const token = await resolveRequiredGitHubToken(request);
    const plan = await planManagedAgentSkillsApply(state.gist.id, withRequiredRequestToken(options.gistOptions, token));
    const result = await applyManagedAgentSkillsPlan(plan, options.applyWriteOptions);
    await rememberGitHubTokenIfRequested(request, token);
    return { state: await summarizeState(request.statePath), result };
  } catch (error) {
    throw toManagedAgentSkillsRuntimeError(error);
  }
}

async function summarizeState(statePath: string | undefined): Promise<RuntimeStateSummary> {
  return (await getRuntimeState({ statePath })).state;
}

async function requireGistState(statePath: string | undefined): Promise<{ gist: { id: string } }> {
  const state = await readLocalState(statePath);
  if (state.gist === undefined) {
    throw new RuntimeApiError('state-error', 'Run remote setup or init before syncing agent skills.');
  }
  return { gist: state.gist };
}

async function resolveRequiredGitHubToken(request: { githubToken?: string; statePath?: string }): Promise<string> {
  const requestToken = request.githubToken?.trim();
  if (requestToken !== undefined && requestToken !== '') {
    return requestToken;
  }
  const savedToken = (await readSecrets(request.statePath)).githubToken;
  if (savedToken === undefined) {
    throw new RuntimeApiError('invalid-request', 'githubToken is required.');
  }
  return savedToken;
}

async function rememberGitHubTokenIfRequested(
  request: { rememberGitHubToken?: boolean; githubToken?: string; statePath?: string },
  token: string,
): Promise<void> {
  if (request.rememberGitHubToken !== true || request.githubToken === undefined) {
    return;
  }
  await saveGitHubToken(token, request.statePath);
}

function withRequiredRequestToken(options: FetchGistOptions | undefined, token: string): FetchGistOptions {
  return { ...options, token };
}

function toManagedAgentSkillsRuntimeError(error: unknown): RuntimeApiError {
  if (error instanceof RuntimeApiError) {
    return error;
  }
  if (error instanceof GistError) {
    return new RuntimeApiError('gist-error', error.message);
  }
  if (error instanceof StateError) {
    return new RuntimeApiError('state-error', error.message);
  }
  if (error instanceof ManagedAgentSkillsError) {
    return new RuntimeApiError('apply-error', error.message);
  }
  return new RuntimeApiError('apply-error', error instanceof Error ? error.message : String(error));
}
