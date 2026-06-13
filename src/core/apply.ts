import { access, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveAdapterConfigPath, type AdapterName } from '../adapters/registry';
import { renderClaudeCodeConfigObject } from '../adapters/claude';
import { codexEnvKeyForProvider, renderCodexConfig } from '../adapters/codex';
import { renderOpenClawConfigObject } from '../adapters/openclaw';
import { renderOpenCodeConfigObject } from '../adapters/opencode';
import { atomicWriteFile, type AtomicWriteFileOptions, type AtomicWriteFileResult } from './atomic-write';
import {
  diffManagedSnapshots,
  unsupportedCodexManagedFieldNotices,
  type ManagedDiffChange,
  type ManagedDiffNotice,
  type ManagedDiffSnapshot,
} from './diff';
import { isNodeErrorWithCode } from './node-errors';
import {
  detectNativeConfigFormat,
  parseNativeConfig,
  serializeNativeConfig,
  type NativeConfigObject,
  type NativeConfigValue,
} from './native-io';
import { type BackupOptions } from './backup';
import { getSelectedProviderConfig, type CanonicalAgentConfig } from './schema';

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
  notices: ManagedDiffNotice[];
  operations: ApplyWriteOperation[];
};

export type ApplyAgentResult = {
  agent: AdapterName;
  configPath?: string;
  envPath?: string;
  status: 'would-change' | 'unchanged' | 'applied' | 'failed' | 'cancelled';
  changes: ManagedDiffChange[];
  notices: ManagedDiffNotice[];
  backups: string[];
  error?: string;
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
        notices: [],
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
    notices: plan.notices,
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
  if (agent === 'claude') {
    return planClaudeApply(config, options);
  }
  return planOpenClawApply(config, options);
}

async function planCodexApply(config: CanonicalAgentConfig, options: ApplyPlanOptions): Promise<ApplyAgentPlan> {
  const selected = getSelectedProviderConfig(config);
  const configPath = await resolveAdapterConfigPath('codex', options);
  const currentText = await readNativeText(configPath, 'codex');
  const current = assertNativeObject(parseNativeConfig(currentText, 'toml'), 'Codex config');
  const rendered = renderCodexConfig(config, currentText);
  const expected = assertNativeObject(parseNativeConfig(rendered.toml, 'toml'), 'rendered Codex config');
  const envKey = codexEnvKeyForProvider(selected.providerId);
  const envPath = resolveCodexApplyEnvPath(options);
  const currentEnv = await readOptionalText(envPath);
  const expectedEnv = rendered.envFile?.content ?? `${envKey}=${selected.provider.apiKey.value}\n`;
  const changes = diffManagedSnapshots(
    codexSnapshot(current, envKey, currentEnv),
    codexSnapshot(expected, envKey, expectedEnv),
  );
  const operations: ApplyWriteOperation[] = [];

  if (changes.some((change) => change.field !== 'apiKey')) {
    operations.push({ path: configPath, content: rendered.toml, kind: 'native' });
  }
  if (changes.some((change) => change.field === 'apiKey')) {
    operations.push({ path: envPath, content: expectedEnv, mode: 0o600, kind: 'env' });
  }

  return {
    agent: 'codex',
    configPath,
    envPath,
    changes,
    notices: unsupportedCodexManagedFieldNotices(selected.model),
    operations,
  };
}

async function planOpenCodeApply(config: CanonicalAgentConfig, options: ApplyPlanOptions): Promise<ApplyAgentPlan> {
  const selected = getSelectedProviderConfig(config);
  const configPath = await resolveAdapterConfigPath('opencode', options);
  const format = detectNativeConfigFormat(configPath);
  const currentText = await readNativeText(configPath, 'opencode');
  const current = assertNativeObject(parseNativeConfig(currentText, format), 'OpenCode config');
  const expected = renderOpenCodeConfigObject(config, current);
  const changes = diffManagedSnapshots(openCodeSnapshot(current, selected.providerId), openCodeSnapshot(expected, selected.providerId));

  return {
    agent: 'opencode',
    configPath,
    changes,
    notices: [],
    operations:
      changes.length === 0
        ? []
        : [{ path: configPath, content: serializeNativeConfig(expected, format), mode: 0o600, kind: 'native' }],
  };
}

async function planOpenClawApply(config: CanonicalAgentConfig, options: ApplyPlanOptions): Promise<ApplyAgentPlan> {
  const selected = getSelectedProviderConfig(config);
  const configPath = await resolveAdapterConfigPath('openclaw', options);
  const format = detectNativeConfigFormat(configPath);
  const currentText = await readNativeText(configPath, 'openclaw');
  const current = assertNativeObject(parseNativeConfig(currentText, format), 'OpenClaw config');
  const expected = renderOpenClawConfigObject(config, current);
  const changes = diffManagedSnapshots(openClawSnapshot(current, selected.providerId), openClawSnapshot(expected, selected.providerId));

  return {
    agent: 'openclaw',
    configPath,
    changes,
    notices: [],
    operations:
      changes.length === 0
        ? []
        : [{ path: configPath, content: serializeNativeConfig(expected, format), mode: 0o600, kind: 'native' }],
  };
}

async function planClaudeApply(config: CanonicalAgentConfig, options: ApplyPlanOptions): Promise<ApplyAgentPlan> {
  const configPath = await resolveAdapterConfigPath('claude', options);
  const format = detectNativeConfigFormat(configPath);
  const currentText = await readNativeText(configPath, 'claude');
  const current = assertNativeObject(parseNativeConfig(currentText, format), 'Claude Code settings');
  const expected = renderClaudeCodeConfigObject(config, current);
  const changes = diffManagedSnapshots(claudeSnapshot(current), claudeSnapshot(expected));

  return {
    agent: 'claude',
    configPath,
    changes,
    notices: [],
    operations:
      changes.length === 0
        ? []
        : [{ path: configPath, content: serializeNativeConfig(expected, format), mode: 0o600, kind: 'native' }],
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
  const model = parsedModel?.model;
  return {
    provider: parsedModel?.provider,
    model,
    baseURL: getString(config, ['provider', provider, 'options', 'baseURL']),
    apiKey: getString(config, ['provider', provider, 'options', 'apiKey']),
    contextWindow: model === undefined ? undefined : getNumberString(config, ['provider', provider, 'models', model, 'limit', 'context']),
    contextTokens: model === undefined ? undefined : getNumberString(config, ['provider', provider, 'models', model, 'limit', 'input']),
    maxTokens: model === undefined ? undefined : getNumberString(config, ['provider', provider, 'models', model, 'limit', 'output']),
  };
}

function openClawSnapshot(config: NativeConfigObject, canonicalProvider: string): ManagedDiffSnapshot {
  const parsedModel = parseProviderModel(getString(config, ['agents', 'defaults', 'model', 'primary']));
  const provider = parsedModel?.provider ?? canonicalProvider;
  const model = parsedModel?.model;
  const modelConfig = model === undefined ? undefined : getOpenClawModelConfig(config, provider, model);
  return {
    provider: parsedModel?.provider,
    model,
    baseURL: getString(config, ['models', 'providers', provider, 'baseUrl']),
    apiKey: getString(config, ['models', 'providers', provider, 'apiKey']),
    contextWindow: modelConfig === undefined ? undefined : getNumberString(modelConfig, ['contextWindow']),
    contextTokens: modelConfig === undefined ? undefined : getNumberString(modelConfig, ['contextTokens']),
    maxTokens: modelConfig === undefined ? undefined : getNumberString(modelConfig, ['maxTokens']),
  };
}

function claudeSnapshot(config: NativeConfigObject): ManagedDiffSnapshot {
  return {
    model: getString(config, ['model']),
    baseURL: getString(config, ['env', 'ANTHROPIC_BASE_URL']),
    apiKey: getString(config, ['env', 'ANTHROPIC_API_KEY']),
  };
}

function getOpenClawModelConfig(config: NativeConfigObject, provider: string, model: string): NativeConfigObject | undefined {
  const providerConfig = getObject(config, ['models', 'providers', provider]);
  const models = providerConfig?.models;

  if (models === undefined) {
    return undefined;
  }

  if (!Array.isArray(models)) {
    throw new Error(`Unsupported native shape at models.providers.${provider}.models; expected array`);
  }

  for (const entry of models) {
    if (isNativeObject(entry) && entry.id === model) {
      return entry;
    }
  }

  return undefined;
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

function getNumberString(config: NativeConfigObject, path: string[]): string | undefined {
  const value = getValue(config, path);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number') {
    throw new Error(`Unsupported native shape at ${path.join('.')}; expected number`);
  }

  return String(value);
}

function getObject(config: NativeConfigObject, path: string[]): NativeConfigObject | undefined {
  const value = getValue(config, path);

  if (value === undefined) {
    return undefined;
  }

  if (!isNativeObject(value)) {
    throw new Error(`Unsupported native shape at ${path.join('.')}; expected object`);
  }

  return value;
}

function getValue(config: NativeConfigObject, path: string[]): NativeConfigValue | undefined {
  let current: NativeConfigValue | undefined = config;

  for (const segment of path) {
    if (!isNativeObject(current)) {
      return undefined;
    }
    current = current[segment];
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
