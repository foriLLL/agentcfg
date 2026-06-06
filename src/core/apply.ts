import { access, readFile, readdir, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAdapter, type AdapterName } from '../adapters/registry';
import { codexEnvKeyForProvider, renderCodexConfig } from '../adapters/codex';
import { renderOpenClawConfigObject } from '../adapters/openclaw';
import { renderOpenCodeConfigObject } from '../adapters/opencode';
import { atomicWriteFile, type AtomicWriteFileOptions, type AtomicWriteFileResult } from './atomic-write';
import { diffManagedSnapshots, type ManagedDiffChange, type ManagedDiffSnapshot } from './diff';
import {
  detectNativeConfigFormat,
  parseNativeConfig,
  serializeNativeConfig,
  type NativeConfigObject,
  type NativeConfigValue,
} from './native-io';
import { type BackupOptions } from './backup';
import { type CanonicalAgentConfig } from './schema';

export type ApplyPlanOptions = {
  configPath?: string;
  fixturesRoot?: string;
};

export type ApplyWriteOptions = BackupOptions & Pick<AtomicWriteFileOptions, 'beforeRename'>;

export type ApplyWriteOperation = {
  path: string;
  content: string;
  mode?: number;
  kind: 'native' | 'env';
};

export type ApplyAgentPlan = {
  agent: AdapterName;
  configPath: string;
  envPath?: string;
  changes: ManagedDiffChange[];
  operations: ApplyWriteOperation[];
};

export type ApplyAgentResult = {
  agent: AdapterName;
  configPath?: string;
  envPath?: string;
  status: 'would-change' | 'unchanged' | 'applied' | 'failed' | 'cancelled';
  changes: ManagedDiffChange[];
  backups: string[];
  error?: string;
};

type NativePathResolution = {
  configPath: string;
};

type RollbackRecord = {
  path: string;
  previousContent?: string;
  previousMode?: number;
};

export class ApplyValidationError extends Error {
  readonly results: ApplyAgentResult[];

  constructor(results: ApplyAgentResult[]) {
    super('Apply validation failed; no files were written.');
    this.name = 'ApplyValidationError';
    this.results = results;
  }
}

export async function planApply(
  config: CanonicalAgentConfig,
  selectedAgents: AdapterName[],
  options: ApplyPlanOptions = {},
): Promise<ApplyAgentPlan[]> {
  const plans: ApplyAgentPlan[] = [];
  const results: ApplyAgentResult[] = [];

  for (const agent of selectedAgents) {
    try {
      const plan = await planAgentApply(config, agent, options);
      plans.push(plan);
      results.push(planToResult(plan, plan.changes.length === 0 ? 'unchanged' : 'would-change'));
    } catch (error) {
      results.push({
        agent,
        status: 'failed',
        changes: [],
        backups: [],
        error: formatError(error),
      });
    }
  }

  if (results.some((result) => result.status === 'failed')) {
    throw new ApplyValidationError(results);
  }

  return plans;
}

export async function applyPlan(plans: ApplyAgentPlan[], options: ApplyWriteOptions = {}): Promise<ApplyAgentResult[]> {
  const rollbackRecords: RollbackRecord[] = [];
  const writeResults = new Map<string, AtomicWriteFileResult>();
  const operations = plans.flatMap((plan) => plan.operations);

  try {
    await preflightWriteOperations(operations);

    for (const operation of operations) {
      rollbackRecords.push(await captureRollbackRecord(operation.path));
      const result = await atomicWriteFile(operation.path, operation.content, {
        ...options,
        mode: operation.mode,
      });
      writeResults.set(operation.path, result);
    }

    for (const plan of plans) {
      await verifyWrittenPlan(plan);
    }
  } catch (error) {
    await rollbackWrites(rollbackRecords);
    throw error;
  }

  return plans.map((plan) => ({
    ...planToResult(plan, plan.operations.length === 0 ? 'unchanged' : 'applied'),
    backups: plan.operations.flatMap((operation) => {
      const backupPath = writeResults.get(operation.path)?.backup?.backupPath;
      return backupPath === undefined ? [] : [backupPath];
    }),
  }));
}

export function plansToResults(plans: ApplyAgentPlan[], status: 'would-change' | 'unchanged'): ApplyAgentResult[] {
  return plans.map((plan) => planToResult(plan, plan.changes.length === 0 ? 'unchanged' : status));
}

function planToResult(plan: ApplyAgentPlan, status: ApplyAgentResult['status']): ApplyAgentResult {
  return {
    agent: plan.agent,
    configPath: plan.configPath,
    envPath: plan.envPath,
    status,
    changes: plan.changes,
    backups: [],
  };
}

async function planAgentApply(
  config: CanonicalAgentConfig,
  agent: AdapterName,
  options: ApplyPlanOptions,
): Promise<ApplyAgentPlan> {
  if (agent === 'codex') {
    return planCodexApply(config, options);
  }
  if (agent === 'opencode') {
    return planOpenCodeApply(config, options);
  }
  return planOpenClawApply(config, options);
}

async function planCodexApply(config: CanonicalAgentConfig, options: ApplyPlanOptions): Promise<ApplyAgentPlan> {
  const paths = await resolveNativePath('codex', options);
  const currentText = await readNativeText(paths.configPath, 'codex');
  const current = assertNativeObject(parseNativeConfig(currentText, 'toml'), 'Codex config');
  const rendered = renderCodexConfig(config, currentText);
  const expected = assertNativeObject(parseNativeConfig(rendered.toml, 'toml'), 'rendered Codex config');
  const envKey = codexEnvKeyForProvider(config.provider);
  const envPath = resolveCodexApplyEnvPath(options);
  const currentEnv = await readOptionalText(envPath);
  const expectedEnv = rendered.envFile?.content ?? `${envKey}=${config.apiKey.value}\n`;
  const changes = diffManagedSnapshots(
    codexSnapshot(current, envKey, currentEnv),
    codexSnapshot(expected, envKey, expectedEnv),
  );
  const operations: ApplyWriteOperation[] = [];

  if (changes.some((change) => change.field !== 'apiKey')) {
    operations.push({ path: paths.configPath, content: rendered.toml, kind: 'native' });
  }
  if (changes.some((change) => change.field === 'apiKey')) {
    operations.push({ path: envPath, content: expectedEnv, mode: 0o600, kind: 'env' });
  }

  return {
    agent: 'codex',
    configPath: paths.configPath,
    envPath,
    changes,
    operations,
  };
}

async function planOpenCodeApply(config: CanonicalAgentConfig, options: ApplyPlanOptions): Promise<ApplyAgentPlan> {
  const paths = await resolveNativePath('opencode', options);
  const format = detectNativeConfigFormat(paths.configPath);
  const currentText = await readNativeText(paths.configPath, 'opencode');
  const current = assertNativeObject(parseNativeConfig(currentText, format), 'OpenCode config');
  const expected = renderOpenCodeConfigObject(config, current);
  const changes = diffManagedSnapshots(openCodeSnapshot(current, config.provider), openCodeSnapshot(expected, config.provider));

  return {
    agent: 'opencode',
    configPath: paths.configPath,
    changes,
    operations:
      changes.length === 0
        ? []
        : [{ path: paths.configPath, content: serializeNativeConfig(expected, format), mode: 0o600, kind: 'native' }],
  };
}

async function planOpenClawApply(config: CanonicalAgentConfig, options: ApplyPlanOptions): Promise<ApplyAgentPlan> {
  const paths = await resolveNativePath('openclaw', options);
  const format = detectNativeConfigFormat(paths.configPath);
  const currentText = await readNativeText(paths.configPath, 'openclaw');
  const current = assertNativeObject(parseNativeConfig(currentText, format), 'OpenClaw config');
  const expected = renderOpenClawConfigObject(config, current);
  const changes = diffManagedSnapshots(openClawSnapshot(current, config.provider), openClawSnapshot(expected, config.provider));

  return {
    agent: 'openclaw',
    configPath: paths.configPath,
    changes,
    operations:
      changes.length === 0
        ? []
        : [{ path: paths.configPath, content: serializeNativeConfig(expected, format), mode: 0o600, kind: 'native' }],
  };
}

async function verifyWrittenPlan(plan: ApplyAgentPlan): Promise<void> {
  for (const operation of plan.operations) {
    if (operation.kind === 'native') {
      const format = detectNativeConfigFormat(operation.path);
      const written = parseNativeConfig(await readFile(operation.path, 'utf8'), format);
      const expected = parseNativeConfig(operation.content, format);
      if (JSON.stringify(written) !== JSON.stringify(expected)) {
        throw new Error(`Post-write verification failed for native config: ${operation.path}`);
      }
    } else {
      const written = await readFile(operation.path, 'utf8');
      if (written !== operation.content) {
        throw new Error(`Post-write verification failed for generated env file: ${operation.path}`);
      }
    }
  }
}

async function resolveNativePath(agent: AdapterName, options: ApplyPlanOptions): Promise<NativePathResolution> {
  const adapter = getAdapter(agent);
  if (options.configPath !== undefined) {
    return { configPath: await resolveConfiguredPath(agent, options.configPath) };
  }

  if (options.fixturesRoot !== undefined) {
    return { configPath: await resolveCandidateInDirectory(agent, join(options.fixturesRoot, agent)) };
  }

  return { configPath: adapter.defaultConfigPath() };
}

async function resolveConfiguredPath(agent: AdapterName, configPath: string): Promise<string> {
  const stats = await stat(configPath).catch((error: unknown) => {
    throw new Error(`Missing ${agent} native config path: ${configPath} (${formatError(error)})`);
  });

  if (stats.isDirectory()) {
    return resolveCandidateInDirectory(agent, configPath);
  }

  return configPath;
}

async function resolveCandidateInDirectory(agent: AdapterName, directory: string): Promise<string> {
  const adapter = getAdapter(agent);
  const entries = await readdir(directory).catch((error: unknown) => {
    throw new Error(`Missing ${agent} native config directory: ${directory} (${formatError(error)})`);
  });
  const matches = adapter.configFileCandidates.filter((candidate) => entries.includes(candidate));

  if (matches.length === 0) {
    throw new Error(`Missing ${agent} native config in ${directory}`);
  }

  if (matches.length > 1) {
    throw new Error(`Ambiguous ${agent} native config in ${directory}: ${matches.join(', ')}`);
  }

  return join(directory, matches[0]);
}

function resolveCodexApplyEnvPath(options: ApplyPlanOptions): string {
  if (options.fixturesRoot !== undefined) {
    return join(options.fixturesRoot, 'codex', 'codex.env');
  }

  return join(homedir(), '.agentcfg', 'env', 'codex.env');
}

async function readNativeText(configPath: string, agent: AdapterName): Promise<string> {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error) {
    throw new Error(`Missing ${agent} native config at ${configPath}: ${formatError(error)}`);
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    await access(path);
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

function codexSnapshot(config: NativeConfigObject, envKey: string, envText: string | undefined): ManagedDiffSnapshot {
  const provider = getString(config, ['model_provider']);
  return {
    provider,
    model: getString(config, ['model']),
    baseURL: provider === undefined ? undefined : getString(config, ['model_providers', provider, 'base_url']),
    apiKey: readEnvValue(envText, envKey),
  };
}

function openCodeSnapshot(config: NativeConfigObject, canonicalProvider: string): ManagedDiffSnapshot {
  const parsedModel = parseProviderModel(getString(config, ['model']));
  const provider = parsedModel?.provider ?? canonicalProvider;
  return {
    provider: parsedModel?.provider,
    model: parsedModel?.model,
    baseURL: getString(config, ['provider', provider, 'options', 'baseURL']),
    apiKey: getString(config, ['provider', provider, 'options', 'apiKey']),
  };
}

function openClawSnapshot(config: NativeConfigObject, canonicalProvider: string): ManagedDiffSnapshot {
  const parsedModel = parseProviderModel(getString(config, ['agents', 'defaults', 'model', 'primary']));
  const provider = parsedModel?.provider ?? canonicalProvider;
  return {
    provider: parsedModel?.provider,
    model: parsedModel?.model,
    baseURL: getString(config, ['models', 'providers', provider, 'baseUrl']),
    apiKey: getString(config, ['models', 'providers', provider, 'apiKey']),
  };
}

function parseProviderModel(value: string | undefined): { provider: string; model: string } | undefined {
  if (value === undefined) {
    return undefined;
  }

  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error(`Unsupported native model shape '${value}'; expected <provider>/<model>`);
  }

  return {
    provider: value.slice(0, separatorIndex),
    model: value.slice(separatorIndex + 1),
  };
}

function getString(config: NativeConfigObject, path: string[]): string | undefined {
  let current: NativeConfigValue | undefined = config;

  for (const segment of path) {
    if (!isNativeObject(current)) {
      return undefined;
    }
    current = current[segment];
  }

  if (current === undefined) {
    return undefined;
  }

  if (typeof current !== 'string') {
    throw new Error(`Unsupported native shape at ${path.join('.')}; expected string`);
  }

  return current;
}

function readEnvValue(envText: string | undefined, envKey: string): string | undefined {
  if (envText === undefined) {
    return undefined;
  }

  for (const line of envText.replace(/\r\n/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    if (trimmed.slice(0, separatorIndex).trim() === envKey) {
      return trimmed.slice(separatorIndex + 1).trim();
    }
  }

  return undefined;
}

function assertNativeObject(value: NativeConfigValue, description: string): NativeConfigObject {
  if (!isNativeObject(value)) {
    throw new Error(`Unsupported native shape: ${description} must be an object`);
  }

  return value;
}

function isNativeObject(value: NativeConfigValue | undefined): value is NativeConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function captureRollbackRecord(path: string): Promise<RollbackRecord> {
  try {
    const stats = await stat(path);
    return { path, previousContent: await readFile(path, 'utf8'), previousMode: stats.mode & 0o777 };
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return { path };
    }
    throw error;
  }
}

async function rollbackWrites(records: RollbackRecord[]): Promise<void> {
  for (const record of records.reverse()) {
    if (record.previousContent === undefined) {
      await rm(record.path, { force: true });
      continue;
    }

    await atomicWriteFile(record.path, record.previousContent, { createBackup: false, mode: record.previousMode });
  }
}

async function preflightWriteOperations(operations: ApplyWriteOperation[]): Promise<void> {
  for (const operation of operations) {
    await preflightWriteTarget(operation.path);
  }
}

async function preflightWriteTarget(path: string): Promise<void> {
  try {
    const stats = await stat(path);
    if ((stats.mode & 0o222) === 0) {
      throw new Error(`Refusing to write read-only existing file: ${path}`);
    }
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
