import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { atomicWriteFile } from './atomic-write';
import { isNodeErrorWithCode } from './node-errors';
import { validateAgentConfig, type AgentConfigInput, type CanonicalAgentConfig } from './schema';

export const STATE_SCHEMA_VERSION = 1;
export const DEFAULT_STATE_PATH = join(homedir(), '.agentcfg', 'state.json');
export const DEFAULT_LAST_STATE_PATH_PATH = join(dirname(DEFAULT_STATE_PATH), 'last-state-path.json');

export type GistIdentity = {
  id: string;
};

export type RemoteRevisionMetadata = {
  revision?: string;
  etag?: string;
  pulledAt: string;
};

export type CachedAgentConfig = {
  config: CanonicalAgentConfig;
  updatedAt: string;
};

export type ConflictMetadata = {
  baseConfig: CanonicalAgentConfig;
  baseRevision?: string;
  baseETag?: string;
};

export type AutoSyncConfig = {
  enabled: boolean;
  intervalMinutes: number;
  targets: string[];
};

export type LastSyncRunSummary = {
  status: 'success' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string;
  message?: string;
};

export type AgentCfgState = {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  gist?: GistIdentity;
  remote?: RemoteRevisionMetadata;
  cache?: CachedAgentConfig;
  conflict?: ConflictMetadata;
  autoSync?: AutoSyncConfig;
  lastSyncRun?: LastSyncRunSummary;
};

type JsonRecord = Record<string, unknown>;

export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}

export function resolveStatePath(statePath?: string): string {
  if (statePath === undefined || statePath.trim() === '') {
    return DEFAULT_STATE_PATH;
  }

  return resolveUserPath(statePath);
}

export function resolveLastStatePathPath(lastStatePathPath?: string): string {
  if (lastStatePathPath === undefined || lastStatePathPath.trim() === '') {
    return DEFAULT_LAST_STATE_PATH_PATH;
  }

  return resolveUserPath(lastStatePathPath);
}

export async function readLastUsedStatePath(lastStatePathPath?: string): Promise<string | undefined> {
  const resolvedPath = resolveLastStatePathPath(lastStatePathPath);

  try {
    const parsed = JSON.parse(await readFile(resolvedPath, 'utf8')) as unknown;
    if (!isRecord(parsed) || !isNonEmptyString(parsed.statePath)) {
      throw new StateError(`Invalid agentcfg last state path at ${resolvedPath}: statePath must be a non-empty string`);
    }
    return resolveStatePath(parsed.statePath);
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

export async function rememberLastUsedStatePath(statePath: string | undefined, lastStatePathPath?: string): Promise<void> {
  if (statePath === undefined || statePath.trim() === '') {
    return;
  }

  const resolvedStatePath = resolveStatePath(statePath);
  await atomicWriteFile(resolveLastStatePathPath(lastStatePathPath), `${JSON.stringify({ statePath: resolvedStatePath }, null, 2)}\n`, {
    createBackup: false,
    mode: 0o600,
  });
}

function resolveUserPath(path: string): string {
  if (path === '~') {
    return homedir();
  }

  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2));
  }

  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

export async function readLocalState(statePath?: string): Promise<AgentCfgState> {
  const resolvedPath = resolveStatePath(statePath);

  try {
    return parseStateJson(await readFile(resolvedPath, 'utf8'), resolvedPath);
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return createEmptyState();
    }
    throw error;
  }
}

export async function writeLocalState(state: AgentCfgState, statePath?: string): Promise<void> {
  await atomicWriteFile(resolveStatePath(statePath), `${JSON.stringify(state, null, 2)}\n`, {
    createBackup: false,
    mode: 0o600,
  });
}

export async function storeGistIdentity(gistId: string, statePath?: string): Promise<AgentCfgState> {
  const normalizedGistId = gistId.trim();
  if (normalizedGistId === '') {
    throw new StateError('Gist ID is required');
  }

  const existingState = await readLocalState(statePath);
  const state: AgentCfgState =
    existingState.gist?.id === normalizedGistId
      ? { ...existingState, gist: { id: normalizedGistId } }
      : {
          schemaVersion: STATE_SCHEMA_VERSION,
          gist: { id: normalizedGistId },
          autoSync: existingState.autoSync,
          lastSyncRun: existingState.lastSyncRun,
        };

  await writeLocalState(state, statePath);
  return state;
}

export async function updatePulledConfig(
  statePath: string | undefined,
  config: CanonicalAgentConfig,
  metadata: { revision?: string; etag?: string; pulledAt?: string },
): Promise<AgentCfgState> {
  const existingState = await readLocalState(statePath);
  if (existingState.gist === undefined) {
    throw new StateError('Run agentcfg init --gist <gist-id> before pull');
  }

  const pulledAt = metadata.pulledAt ?? new Date().toISOString();
  const state: AgentCfgState = {
    schemaVersion: STATE_SCHEMA_VERSION,
    gist: existingState.gist,
    remote: omitUndefined({
      revision: metadata.revision,
      etag: metadata.etag,
      pulledAt,
    }),
    cache: {
      config,
      updatedAt: pulledAt,
    },
    conflict: omitUndefined({
      baseConfig: config,
      baseRevision: metadata.revision,
      baseETag: metadata.etag,
    }),
    autoSync: existingState.autoSync,
    lastSyncRun: existingState.lastSyncRun,
  };

  await writeLocalState(state, statePath);
  return state;
}

export async function updateAutoSyncConfig(
  statePath: string | undefined,
  autoSync: AutoSyncConfig,
): Promise<AgentCfgState> {
  const existingState = await readLocalState(statePath);
  const state: AgentCfgState = {
    ...existingState,
    autoSync: normalizeAutoSyncConfig(autoSync),
  };
  await writeLocalState(state, statePath);
  return state;
}

export async function updateLastSyncRun(
  statePath: string | undefined,
  lastSyncRun: LastSyncRunSummary,
): Promise<AgentCfgState> {
  const existingState = await readLocalState(statePath);
  const state: AgentCfgState = {
    ...existingState,
    lastSyncRun,
  };
  await writeLocalState(state, statePath);
  return state;
}

export function createEmptyState(): AgentCfgState {
  return { schemaVersion: STATE_SCHEMA_VERSION };
}

function parseStateJson(json: string, path: string): AgentCfgState {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new StateError(
      `Invalid agentcfg state at ${path}: ${error instanceof Error ? error.message : 'JSON parser failed'}`,
    );
  }

  if (!isRecord(parsed)) {
    throw new StateError(`Invalid agentcfg state at ${path}: root must be an object`);
  }

  if (parsed.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new StateError(`Invalid agentcfg state at ${path}: schemaVersion must be 1`);
  }

  return omitUndefined({
    schemaVersion: STATE_SCHEMA_VERSION,
    gist: parseGistIdentity(parsed.gist, path),
    remote: parseRemoteMetadata(parsed.remote, path),
    cache: parseCachedConfig(parsed.cache, path),
    conflict: parseConflictMetadata(parsed.conflict, path),
    autoSync: parseAutoSyncConfig(parsed.autoSync, path),
    lastSyncRun: parseLastSyncRunSummary(parsed.lastSyncRun, path),
  });
}

function parseGistIdentity(value: unknown, path: string): GistIdentity | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isNonEmptyString(value.id)) {
    throw new StateError(`Invalid agentcfg state at ${path}: gist.id must be a non-empty string`);
  }
  return { id: value.id };
}

function parseRemoteMetadata(value: unknown, path: string): RemoteRevisionMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isNonEmptyString(value.pulledAt)) {
    throw new StateError(`Invalid agentcfg state at ${path}: remote.pulledAt must be a non-empty string`);
  }
  return omitUndefined({
    revision: parseOptionalString(value.revision, 'remote.revision', path),
    etag: parseOptionalString(value.etag, 'remote.etag', path),
    pulledAt: value.pulledAt,
  });
}

function parseCachedConfig(value: unknown, path: string): CachedAgentConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isNonEmptyString(value.updatedAt) || !isRecord(value.config)) {
    throw new StateError(`Invalid agentcfg state at ${path}: cache must include config and updatedAt`);
  }
  return {
    config: validateAgentConfig(value.config as AgentConfigInput),
    updatedAt: value.updatedAt,
  };
}

function parseConflictMetadata(value: unknown, path: string): ConflictMetadata | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isRecord(value.baseConfig)) {
    throw new StateError(`Invalid agentcfg state at ${path}: conflict.baseConfig must be an object`);
  }
  return omitUndefined({
    baseConfig: validateAgentConfig(value.baseConfig as AgentConfigInput),
    baseRevision: parseOptionalString(value.baseRevision, 'conflict.baseRevision', path),
    baseETag: parseOptionalString(value.baseETag, 'conflict.baseETag', path),
  });
}

function parseAutoSyncConfig(value: unknown, path: string): AutoSyncConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || typeof value.enabled !== 'boolean') {
    throw new StateError(`Invalid agentcfg state at ${path}: autoSync.enabled must be a boolean`);
  }
  const intervalMinutes = value.intervalMinutes;
  if (typeof intervalMinutes !== 'number' || !Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    throw new StateError(`Invalid agentcfg state at ${path}: autoSync.intervalMinutes must be a positive integer`);
  }
  if (!Array.isArray(value.targets) || !value.targets.every(isNonEmptyString)) {
    throw new StateError(`Invalid agentcfg state at ${path}: autoSync.targets must be an array of non-empty strings`);
  }
  return {
    enabled: value.enabled,
    intervalMinutes,
    targets: [...value.targets],
  };
}

function parseLastSyncRunSummary(value: unknown, path: string): LastSyncRunSummary | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value) || !isSyncStatus(value.status)) {
    throw new StateError(`Invalid agentcfg state at ${path}: lastSyncRun.status is invalid`);
  }
  if (!isNonEmptyString(value.startedAt) || !isNonEmptyString(value.completedAt)) {
    throw new StateError(`Invalid agentcfg state at ${path}: lastSyncRun timestamps must be non-empty strings`);
  }
  return omitUndefined({
    status: value.status,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    message: parseOptionalString(value.message, 'lastSyncRun.message', path),
  });
}

function normalizeAutoSyncConfig(value: AutoSyncConfig): AutoSyncConfig {
  if (!Number.isInteger(value.intervalMinutes) || value.intervalMinutes < 1) {
    throw new StateError('autoSync.intervalMinutes must be a positive integer');
  }
  return {
    enabled: value.enabled,
    intervalMinutes: value.intervalMinutes,
    targets: [...new Set(value.targets.map((target) => target.trim()).filter((target) => target !== ''))],
  };
}

function parseOptionalString(value: unknown, field: string, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw new StateError(`Invalid agentcfg state at ${path}: ${field} must be a non-empty string`);
  }
  return value;
}

function isSyncStatus(value: unknown): value is LastSyncRunSummary['status'] {
  return value === 'success' || value === 'partial' || value === 'failed';
}

function omitUndefined<T extends JsonRecord>(value: T): T {
  const result: JsonRecord = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (entryValue !== undefined) {
      result[key] = entryValue;
    }
  }
  return result as T;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
