import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  DiffError,
  diffManagedSnapshots,
  parseNativeConfig,
  type AgentDiffResult,
  type CanonicalAgentConfig,
  type ManagedDiffSnapshot,
  type NativeConfigObject,
  type NativeConfigValue,
} from '../core';
import { codexEnvKeyForProvider, renderCodexConfig, resolveCodexEnvPath } from './codex';
import { renderOpenClawConfigObject, resolveOpenClawConfigPath } from './openclaw';
import { renderOpenCodeConfigObject } from './opencode';

export const ADAPTER_NAMES = ['codex', 'opencode', 'openclaw'] as const;

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
});

export function getAdapter(name: AdapterName): AdapterRegistryEntry {
  return adapters[name];
}

export function isAdapterName(value: string): value is AdapterName {
  return (ADAPTER_NAMES as readonly string[]).includes(value);
}

async function diffCodex(config: CanonicalAgentConfig, options: AdapterDiffOptions = {}): Promise<AgentDiffResult> {
  const paths = await resolveNativePath(adapters.codex, options);
  const currentText = await readNativeText(paths.configPath, 'codex');
  const current = assertNativeObject(parseNativeConfig(currentText, 'toml'), 'Codex config');
  const expectedText = renderCodexConfig(config, currentText).toml;
  const expected = assertNativeObject(parseNativeConfig(expectedText, 'toml'), 'rendered Codex config');
  const envKey = codexEnvKeyForProvider(config.provider);
  const currentEnv = await readOptionalText(resolveCodexDiffEnvPath(options));

  return {
    agent: 'codex',
    changes: diffManagedSnapshots(
      codexSnapshot(current, envKey, currentEnv),
      codexSnapshot(expected, envKey, `${envKey}=${config.apiKey.value}\n`),
    ),
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
  const current = assertNativeObject(parseNativeConfig(currentText, 'jsonc'), 'OpenCode config');
  const expected = renderOpenCodeConfigObject(config, current);

  return {
    agent: 'opencode',
    changes: diffManagedSnapshots(openCodeSnapshot(current, config.provider), openCodeSnapshot(expected, config.provider)),
  };
}

async function diffOpenClaw(config: CanonicalAgentConfig, options: AdapterDiffOptions = {}): Promise<AgentDiffResult> {
  const paths = await resolveNativePath(adapters.openclaw, options);
  const currentText = await readNativeText(paths.configPath, 'openclaw');
  const current = assertNativeObject(parseNativeConfig(currentText, 'json5'), 'OpenClaw config');
  const expected = renderOpenClawConfigObject(config, current);

  return {
    agent: 'openclaw',
    changes: diffManagedSnapshots(openClawSnapshot(current, config.provider), openClawSnapshot(expected, config.provider)),
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

  return { configPath: adapter.defaultConfigPath() };
}

async function resolveConfiguredPath(adapter: AdapterRegistryEntry, configPath: string): Promise<string> {
  const stats = await stat(configPath).catch((error: unknown) => {
    throw new DiffError(`Missing ${adapter.name} native config path: ${configPath} (${formatError(error)})`);
  });

  if (stats.isDirectory()) {
    return resolveCandidateInDirectory(adapter, configPath);
  }

  return configPath;
}

async function resolveCandidateInDirectory(adapter: AdapterRegistryEntry, directory: string): Promise<string> {
  const entries = await readdir(directory).catch((error: unknown) => {
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

  return {
    provider: parsedModel?.provider,
    model: parsedModel?.model,
    baseURL: getString(config, ['provider', provider, 'options', 'baseURL']),
    apiKey: getString(config, ['provider', provider, 'options', 'apiKey']),
  };
}

function openClawSnapshot(config: NativeConfigObject, canonicalProvider: string): ManagedDiffSnapshot {
  const modelValue = getString(config, ['agents', 'defaults', 'model', 'primary']);
  const parsedModel = parseProviderModel(modelValue);
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

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}
