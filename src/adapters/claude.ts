import { getSelectedProviderConfig, type CanonicalAgentConfig } from '../core/schema';
import { parseNativeConfig, serializeNativeConfig, type NativeConfigObject, type NativeConfigValue } from '../core/native-io';

export class ClaudeCodeAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeCodeAdapterError';
  }
}

export function renderClaudeCodeConfigText(config: CanonicalAgentConfig, existingConfigText: string): string {
  return serializeNativeConfig(renderClaudeCodeConfigObject(config, parseClaudeCodeConfig(existingConfigText)), 'json');
}

export function renderClaudeCodeConfigObject(
  config: CanonicalAgentConfig,
  existingConfig: NativeConfigObject = {},
): NativeConfigObject {
  const selected = getSelectedProviderConfig(config);
  const output = cloneNativeConfigObject(existingConfig);
  const env = ensureEnvObject(output);

  if (env.ANTHROPIC_AUTH_TOKEN !== undefined) {
    throw new ClaudeCodeAdapterError('Claude Code env.ANTHROPIC_AUTH_TOKEN overrides managed API key; remove it before agentcfg can manage Claude Code auth');
  }
  if (env.ANTHROPIC_MODEL !== undefined) {
    throw new ClaudeCodeAdapterError('Claude Code env.ANTHROPIC_MODEL overrides managed model; remove it before agentcfg can manage Claude Code model');
  }

  output.model = selected.modelId;
  env.ANTHROPIC_API_KEY = selected.provider.apiKey.value;
  env.ANTHROPIC_BASE_URL = selected.provider.baseURL;

  return output;
}

function parseClaudeCodeConfig(content: string): NativeConfigObject {
  const parsed = parseNativeConfig(content, 'json');
  if (!isNativeConfigObject(parsed)) {
    throw new ClaudeCodeAdapterError('Claude Code settings must be a JSON object at the top level');
  }
  return parsed;
}

function ensureEnvObject(config: NativeConfigObject): NativeConfigObject {
  const env = config.env;
  if (env === undefined) {
    const created: NativeConfigObject = {};
    config.env = created;
    return created;
  }
  if (!isNativeConfigObject(env)) {
    throw new ClaudeCodeAdapterError('Claude Code settings env must be an object before rendering managed config');
  }
  return env;
}

function cloneNativeConfigObject(value: NativeConfigObject): NativeConfigObject {
  return cloneNativeConfigValue(value) as NativeConfigObject;
}

function cloneNativeConfigValue(value: NativeConfigValue): NativeConfigValue {
  if (Array.isArray(value)) {
    return value.map(cloneNativeConfigValue);
  }
  if (isNativeConfigObject(value)) {
    const cloned: NativeConfigObject = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      cloned[key] = cloneNativeConfigValue(nestedValue);
    }
    return cloned;
  }
  return value;
}

function isNativeConfigObject(value: NativeConfigValue | undefined): value is NativeConfigObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
