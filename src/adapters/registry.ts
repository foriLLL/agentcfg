import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  DiffError,
  diffManagedSnapshots,
  unsupportedCodexManagedFieldNotices,
  parseNativeConfig,
  isNodeErrorWithCode,
  getSelectedProviderConfig,
  type AgentDiffResult,
  type CanonicalAgentConfig,
  type ManagedDiffSnapshot,
  type NativeConfigObject,
  type NativeConfigValue,
} from '../core';
import { codexEnvKeyForProvider, renderCodexConfig, resolveCodexEnvPath } from './codex';
import { renderClaudeCodeConfigObject } from './claude';
import { renderOpenClawConfigObject, resolveOpenClawConfigPath } from './openclaw';
import { renderOpenCodeConfigObject } from './opencode';

export const ADAPTER_NAMES = ['codex', 'opencode', 'openclaw', 'claude'] as const;

export type AdapterName = (typeof ADAPTER_NAMES)[number];

export type AdapterDiffOptions = {
  configPath?: string;
  fixturesRoot?: string;
};

export type AdapterRegistryEntry = {
  name: AdapterName;
  configFileCandidates: readonly string[];
  defaultConfigPath(): string;
  diff(config: CanonicalAgentConfig, options?: AdapterDiffOptions): Promise<AgentDiffResult>;
};

type NativePathResolution = {
  configPath: string;
};

export const adapters: Readonly<Record<AdapterName, AdapterRegistryEntry>> = Object.freeze({
  codex: Object.freeze({
    name: 'codex',
    configFileCandidates: ['config.toml', 'input.config.toml'],
    defaultConfigPath: () => join(homedir(), '.codex', 'config.toml'),
    diff: diffCodex,
  }),
  opencode: Object.freeze({
    name: 'opencode',
    configFileCandidates: ['opencode.jsonc', 'opencode.json', 'input.opencode.jsonc'],
    defaultConfigPath: () => join(homedir(), '.config', 'opencode', 'opencode.jsonc'),
    diff: diffOpenCode,
  }),
  openclaw: Object.freeze({
    name: 'openclaw',
    configFileCandidates: ['openclaw.json', 'openclaw.json5', 'input.openclaw.json5'],
    defaultConfigPath: () => resolveOpenClawConfigPath(),
    diff: diffOpenClaw,
  }),
  claude: Object.freeze({
    name: 'claude',
    configFileCandidates: ['settings.json', 'settings.local.json', 'input.settings.json'],
    defaultConfigPath: () => join(homedir(), '.claude', 'settings.json'),
    diff: diffClaude,
  }),
});

export function getAdapter(name: AdapterName): AdapterRegistryEntry {
  return adapters[name];
}

export function isAdapterName(value: string): value is AdapterName {
  return (ADAPTER_NAMES as readonly string[]).includes(value);
}

export async function resolveAdapterConfigPath(name: AdapterName, options: AdapterDiffOptions = {}): Promise<string> {
  return (await resolveNativePath(getAdapter(name), options)).configPath;
}

async function diffCodex(config: CanonicalAgentConfig, options: AdapterDiffOptions = {}): Promise<AgentDiffResult> {
  const paths = await resolveNativePath(adapters.codex, options);
  const currentText = await readNativeText(paths.configPath, 'codex');
  const current = assertNativeObject(parseNativeConfig(currentText, 'toml'), 'Codex config');
  const selected = getSelectedProviderConfig(config);
  const expectedText = renderCodexConfig(config, currentText).toml;
  const expected = assertNativeObject(parseNativeConfig(expectedText, 'toml'), 'rendered Codex config');
  const envKey = codexEnvKeyForProvider(selected.providerId);
  const currentEnv = await readOptionalText(resolveCodexDiffEnvPath(options));

  return {
    agent: 'codex',
    changes: diffManagedSnapshots(
      codexSnapshot(current, envKey, currentEnv),
      codexSnapshot(expected, envKey, `${envKey}=${selected.provider.apiKey.value}\n`),
    ),
    notices: unsupportedCodexManagedFieldNotices(selected.model),
  };
}

function resolveCodexDiffEnvPath(options: AdapterDiffOptions): string {
  if (options.fixturesRoot !== undefined) {
    return join(options.fixturesRoot, 'codex', 'codex.env');
  }

  return resolveCodexEnvPath();
}

async function diffOpenCode(config: CanonicalAgentConfig, options: AdapterDiffOptions = {}): Promise<AgentDiffResult> {
  const paths = await resolveNativePath(adapters.opencode, options);
  const currentText = await readNativeText(paths.configPath, 'opencode');
  const selected = getSelectedProviderConfig(config);
  const current = assertNativeObject(parseNativeConfig(currentText, 'jsonc'), 'OpenCode config');
  const expected = renderOpenCodeConfigObject(config, current);

  return {
    agent: 'opencode',
    changes: diffManagedSnapshots(openCodeSnapshot(current, selected.providerId), openCodeSnapshot(expected, selected.providerId)),
    notices: [],
  };
}

async function diffOpenClaw(config: CanonicalAgentConfig, options: AdapterDiffOptions = {}): Promise<AgentDiffResult> {
  const paths = await resolveNativePath(adapters.openclaw, options);
  const currentText = await readNativeText(paths.configPath, 'openclaw');
  const selected = getSelectedProviderConfig(config);
  const current = assertNativeObject(parseNativeConfig(currentText, 'json5'), 'OpenClaw config');
  const expected = renderOpenClawConfigObject(config, current);

  return {
    agent: 'openclaw',
    changes: diffManagedSnapshots(openClawSnapshot(current, selected.providerId), openClawSnapshot(expected, selected.providerId)),
    notices: [],
  };
}

async function diffClaude(config: CanonicalAgentConfig, options: AdapterDiffOptions = {}): Promise<AgentDiffResult> {
  const paths = await resolveNativePath(adapters.claude, options);
  const currentText = await readNativeText(paths.configPath, 'claude');
  const current = assertNativeObject(parseNativeConfig(currentText, 'json'), 'Claude Code settings');
  const expected = renderClaudeCodeConfigObject(config, current);

  return {
    agent: 'claude',
    changes: diffManagedSnapshots(claudeSnapshot(current), claudeSnapshot(expected)),
    notices: [],
  };
}

async function resolveNativePath(
  adapter: AdapterRegistryEntry,
  options: AdapterDiffOptions,
): Promise<NativePathResolution> {
  if (options.configPath !== undefined) {
    return { configPath: await resolveConfiguredPath(adapter, options.configPath) };
  }

  if (options.fixturesRoot !== undefined) {
    return { configPath: await resolveCandidateInDirectory(adapter, join(options.fixturesRoot, adapter.name)) };
  }

  return resolveDefaultPath(adapter);
}

async function resolveDefaultPath(adapter: AdapterRegistryEntry): Promise<NativePathResolution> {
  const configPath = adapter.defaultConfigPath();
  const stats = await stat(configPath).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  });

  if (stats?.isDirectory()) {
    return { configPath: await resolveCandidateInDirectory(adapter, configPath) };
  }
  if (stats !== undefined) {
    return { configPath };
  }

  return { configPath: await resolveCandidateInDirectory(adapter, dirname(configPath)) };
}

async function resolveConfiguredPath(adapter: AdapterRegistryEntry, configPath: string): Promise<string> {
  const stats = await stat(configPath).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw new DiffError(`Missing ${adapter.name} native config path: ${configPath} (${formatError(error)})`);
  });

  if (stats === undefined) {
    if (!isConfigFileCandidate(adapter, configPath)) {
      throw new DiffError(`Unsupported ${adapter.name} native config filename: ${basename(configPath)}`);
    }
    return resolveCandidateInDirectory(adapter, dirname(configPath));
  }

  if (stats.isDirectory()) {
    return resolveCandidateInDirectory(adapter, configPath);
  }

  if (!isConfigFileCandidate(adapter, configPath)) {
    throw new DiffError(`Unsupported ${adapter.name} native config filename: ${basename(configPath)}`);
  }

  return configPath;
}

async function resolveCandidateInDirectory(adapter: AdapterRegistryEntry, directory: string): Promise<string> {
  const entries = await readdir(directory).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      throw new DiffError(`Missing ${adapter.name} native config directory: ${directory}`);
    }
    throw new DiffError(`Missing ${adapter.name} native config directory: ${directory} (${formatError(error)})`);
  });
  const matches = adapter.configFileCandidates.filter((candidate) => entries.includes(candidate));

  if (matches.length === 0) {
    throw new DiffError(`Missing ${adapter.name} native config in ${directory}`);
  }

  if (matches.length > 1) {
    throw new DiffError(`Ambiguous ${adapter.name} native config in ${directory}: ${matches.join(', ')}`);
  }

  return join(directory, matches[0]);
}

function isConfigFileCandidate(adapter: AdapterRegistryEntry, configPath: string): boolean {
  return adapter.configFileCandidates.includes(basename(configPath));
}

async function readNativeText(configPath: string, agent: AdapterName): Promise<string> {
  try {
    return await readFile(configPath, 'utf8');
  } catch (error) {
    throw new DiffError(`Missing ${agent} native config at ${configPath}: ${formatError(error)}`);
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return undefined;
    }
    throw new DiffError(`Unable to read optional native env file at ${path}: ${formatError(error)}`);
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
  const modelValue = getString(config, ['model']);
  const parsedModel = parseProviderModel(modelValue);
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
  const modelValue = getString(config, ['agents', 'defaults', 'model', 'primary']);
  const parsedModel = parseProviderModel(modelValue);
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
    throw new DiffError(`Unsupported native shape at models.providers.${provider}.models; expected array`);
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
    throw new DiffError(`Unsupported native model shape '${value}'; expected <provider>/<model>`);
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
    throw new DiffError(`Unsupported native shape at ${path.join('.')}; expected string`);
  }

  return current;
}

function getNumberString(config: NativeConfigObject, path: string[]): string | undefined {
  const value = getValue(config, path);

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number') {
    throw new DiffError(`Unsupported native shape at ${path.join('.')}; expected number`);
  }

  return String(value);
}

function getObject(config: NativeConfigObject, path: string[]): NativeConfigObject | undefined {
  const value = getValue(config, path);

  if (value === undefined) {
    return undefined;
  }

  if (!isNativeObject(value)) {
    throw new DiffError(`Unsupported native shape at ${path.join('.')}; expected object`);
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
    throw new DiffError(`Unsupported native shape: ${description} must be an object`);
  }

  return value;
}

function isNativeObject(value: NativeConfigValue | undefined): value is NativeConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
