import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { atomicWriteFile } from './atomic-write';
import { validateAgentConfig, type AgentConfigInput, type CanonicalAgentConfig } from './schema';

export const STATE_SCHEMA_VERSION = 1;
export const DEFAULT_STATE_PATH = join(homedir(), '.agentcfg', 'state.json');

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

export type AgentCfgState = {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  gist?: GistIdentity;
  remote?: RemoteRevisionMetadata;
  cache?: CachedAgentConfig;
  conflict?: ConflictMetadata;
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

  if (statePath === '~') {
    return homedir();
  }

  if (statePath.startsWith('~/')) {
    return join(homedir(), statePath.slice(2));
  }

  return isAbsolute(statePath) ? statePath : resolve(process.cwd(), statePath);
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
      : { schemaVersion: STATE_SCHEMA_VERSION, gist: { id: normalizedGistId } };

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

function parseOptionalString(value: unknown, field: string, path: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(value)) {
    throw new StateError(`Invalid agentcfg state at ${path}: ${field} must be a non-empty string`);
  }
  return value;
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

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
