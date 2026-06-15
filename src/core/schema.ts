import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export type PlainApiKey = {
  type: 'plain';
  value: string;
};

export type AgentConfigDefaults = {
  provider: string;
  model: string;
};

export type ModelConfig = {
  variant?: string;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
};

export const OH_MY_OPENAGENT_AGENT_NAMES = [
  'sisyphus',
  'hephaestus',
  'prometheus',
  'oracle',
  'librarian',
  'explore',
  'multimodal-looker',
  'metis',
  'momus',
  'atlas',
  'sisyphus-junior',
] as const;

export const OH_MY_OPENAGENT_CATEGORY_NAMES = [
  'visual-engineering',
  'ultrabrain',
  'deep',
  'artistry',
  'quick',
  'unspecified-low',
  'unspecified-high',
  'writing',
] as const;

export const OH_MY_OPENAGENT_MODEL_VARIANTS = ['max', 'high', 'medium', 'low', 'xhigh'] as const;

export type OhMyOpenAgentAgentName = (typeof OH_MY_OPENAGENT_AGENT_NAMES)[number];
export type OhMyOpenAgentCategoryName = (typeof OH_MY_OPENAGENT_CATEGORY_NAMES)[number];
export type OhMyOpenAgentModelVariant = (typeof OH_MY_OPENAGENT_MODEL_VARIANTS)[number];

export type OhMyOpenAgentModelAssignment = {
  model: string;
  variant?: OhMyOpenAgentModelVariant;
};

export type OhMyOpenAgentConfig = {
  agents?: Partial<Record<OhMyOpenAgentAgentName, OhMyOpenAgentModelAssignment>>;
  categories?: Partial<Record<OhMyOpenAgentCategoryName, OhMyOpenAgentModelAssignment>>;
};

export type ProviderConfig = {
  baseURL: string;
  apiKey: PlainApiKey;
  modelDiscovery?: {
    path: string;
  };
  models: Record<string, ModelConfig>;
};

export type CanonicalAgentConfig = {
  schemaVersion: 1;
  defaults: AgentConfigDefaults;
  providers: Record<string, ProviderConfig>;
  ohMyOpenAgent?: OhMyOpenAgentConfig;
};

export type SelectedProviderConfig = {
  providerId: string;
  modelId: string;
  provider: ProviderConfig;
  model: ModelConfig;
};

export type AgentConfigInput = {
  schemaVersion?: unknown;
  provider?: unknown;
  model?: unknown;
  baseURL?: unknown;
  apiKey?: unknown;
  defaults?: unknown;
  providers?: unknown;
  ohMyOpenAgent?: unknown;
};

export class AgentConfigValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid agentcfg.yaml: ${issues.join('; ')}`);
    this.name = 'AgentConfigValidationError';
    this.issues = issues;
  }
}

export function parseAgentConfigYaml(yaml: string): AgentConfigInput {
  try {
    const parsed = parseYaml(yaml) as unknown;

    if (parsed === null) {
      return {};
    }

    if (!isRecord(parsed)) {
      throw new AgentConfigValidationError(['top-level YAML document must be a mapping']);
    }

    return parsed;
  } catch (error) {
    if (error instanceof AgentConfigValidationError) {
      throw error;
    }

    throw new AgentConfigValidationError([`YAML parser failed: ${formatParserError(error)}`]);
  }
}

export function parseCanonicalAgentConfig(yaml: string): CanonicalAgentConfig {
  return validateAgentConfig(parseAgentConfigYaml(yaml));
}

export function serializeCanonicalAgentConfig(config: AgentConfigInput): string {
  const canonicalConfig = validateNestedAgentConfig(config);
  const providers: Record<string, ProviderConfig> = {};

  for (const [providerId, provider] of Object.entries(canonicalConfig.providers)) {
    providers[providerId] = serializeProvider(provider);
  }

  return stringifyYaml({
    schemaVersion: canonicalConfig.schemaVersion,
    defaults: {
      provider: canonicalConfig.defaults.provider,
      model: canonicalConfig.defaults.model,
    },
    providers,
    ...(canonicalConfig.ohMyOpenAgent === undefined ? {} : { ohMyOpenAgent: canonicalConfig.ohMyOpenAgent }),
  });
}

export function validateAgentConfig(input: AgentConfigInput): CanonicalAgentConfig {
  return validateNestedAgentConfig(input);
}

export function getSelectedProviderConfig(config: CanonicalAgentConfig): SelectedProviderConfig {
  const providerId = config.defaults.provider;
  const modelId = config.defaults.model;
  const provider = config.providers[providerId];

  if (provider === undefined) {
    throw new AgentConfigValidationError([`defaults.provider must reference an existing provider (received ${providerId})`]);
  }

  const model = provider.models[modelId];

  if (model === undefined) {
    throw new AgentConfigValidationError([`defaults.model must reference an existing model under defaults.provider (received ${modelId})`]);
  }

  return { providerId, modelId, provider, model };
}

function validateNestedAgentConfig(input: AgentConfigInput): CanonicalAgentConfig {
  const issues: string[] = [];
  const schemaVersion = normalizeSchemaVersion(input.schemaVersion);

  if (schemaVersion !== 1) {
    const received = input.schemaVersion === undefined ? 'missing' : String(input.schemaVersion);
    issues.push(`schemaVersion must be 1 before parsing native configs (received ${received})`);
  }

  const defaults = validateDefaults(input.defaults, issues);
  const providers = validateProviders(input.providers, issues);
  const ohMyOpenAgent = providers === undefined ? undefined : validateOhMyOpenAgentConfig(input.ohMyOpenAgent, providers, issues);

  if (defaults !== undefined && providers !== undefined) {
    const defaultProvider = providers[defaults.provider];

    if (defaultProvider === undefined) {
      issues.push(`defaults.provider must reference an existing provider (received ${defaults.provider})`);
    } else if (defaultProvider.models[defaults.model] === undefined) {
      issues.push(`defaults.model must reference an existing model under defaults.provider (received ${defaults.model})`);
    }
  }

  if (issues.length > 0) {
    throw new AgentConfigValidationError(issues);
  }

  return {
    schemaVersion: 1,
    defaults: defaults as AgentConfigDefaults,
    providers: providers as Record<string, ProviderConfig>,
    ...(ohMyOpenAgent === undefined ? {} : { ohMyOpenAgent }),
  };
}

function serializeProvider(provider: ProviderConfig): ProviderConfig {
  const serializedModels: Record<string, ModelConfig> = {};

  for (const [modelId, model] of Object.entries(provider.models)) {
    const serializedModel: ModelConfig = {};

    if (model.variant !== undefined) {
      serializedModel.variant = model.variant;
    }

    if (model.contextWindow !== undefined) {
      serializedModel.contextWindow = model.contextWindow;
    }

    if (model.contextTokens !== undefined) {
      serializedModel.contextTokens = model.contextTokens;
    }

    if (model.maxTokens !== undefined) {
      serializedModel.maxTokens = model.maxTokens;
    }

    serializedModels[modelId] = serializedModel;
  }

  const serializedProvider: ProviderConfig = {
    baseURL: provider.baseURL,
    apiKey: {
      type: provider.apiKey.type,
      value: provider.apiKey.value,
    },
    models: serializedModels,
  };

  if (provider.modelDiscovery !== undefined) {
    return {
      baseURL: serializedProvider.baseURL,
      apiKey: serializedProvider.apiKey,
      modelDiscovery: {
        path: provider.modelDiscovery.path,
      },
      models: serializedProvider.models,
    };
  }

  return serializedProvider;
}

function validateDefaults(value: unknown, issues: string[]): AgentConfigDefaults | undefined {
  if (!isRecord(value)) {
    issues.push('defaults is required and must be an object');
    return undefined;
  }

  const provider = value.provider;
  const model = value.model;

  if (!isNonEmptyString(provider)) {
    issues.push('defaults.provider is required and must be a non-empty string');
  }

  if (!isNonEmptyString(model)) {
    issues.push('defaults.model is required and must be a non-empty string');
  }

  if (!isNonEmptyString(provider) || !isNonEmptyString(model)) {
    return undefined;
  }

  return { provider, model };
}

function validateProviders(value: unknown, issues: string[]): Record<string, ProviderConfig> | undefined {
  if (!isRecord(value)) {
    issues.push('providers is required and must be an object with at least one provider');
    return undefined;
  }

  const providerEntries = Object.entries(value);
  if (providerEntries.length === 0) {
    issues.push('providers is required and must include at least one provider');
    return undefined;
  }

  const providers: Record<string, ProviderConfig> = {};

  for (const [providerId, providerValue] of providerEntries) {
    if (!isNonEmptyString(providerId)) {
      issues.push('providers must use non-empty provider IDs');
      continue;
    }

    if (providerId.includes('/')) {
      issues.push(`providers.${providerId} must not include / because OhMyOpenAgent model references use provider/model`);
      continue;
    }

    const provider = validateProvider(providerId, providerValue, issues);
    if (provider !== undefined) {
      providers[providerId] = provider;
    }
  }

  return providers;
}

function validateProvider(providerId: string, value: unknown, issues: string[]): ProviderConfig | undefined {
  const path = `providers.${providerId}`;

  if (!isRecord(value)) {
    issues.push(`${path} is required and must be an object`);
    return undefined;
  }

  if (!isNonEmptyString(value.baseURL)) {
    issues.push(`${path}.baseURL is required and must be a non-empty string`);
  }

  const apiKey = validateApiKey(`${path}.apiKey`, value.apiKey, issues);
  const modelDiscovery = validateModelDiscovery(`${path}.modelDiscovery`, value.modelDiscovery, issues);
  const models = validateModels(`${path}.models`, value.models, issues);

  if (!isNonEmptyString(value.baseURL) || apiKey === undefined || models === undefined) {
    return undefined;
  }

  const provider: ProviderConfig = {
    baseURL: value.baseURL,
    apiKey,
    models,
  };

  if (modelDiscovery !== undefined) {
    provider.modelDiscovery = modelDiscovery;
  }

  return provider;
}

function validateApiKey(path: string, value: unknown, issues: string[]): PlainApiKey | undefined {
  if (!isRecord(value)) {
    issues.push(`${path} is required and must be an object`);
    issues.push(`${path}.type is required and must be plain`);
    issues.push(`${path}.value is required and must be a non-empty string`);
    return undefined;
  }

  if (value.type !== 'plain') {
    issues.push(`${path}.type is required and must be plain`);
  }

  if (!isNonEmptyString(value.value)) {
    issues.push(`${path}.value is required and must be a non-empty string`);
  }

  if (value.type !== 'plain' || !isNonEmptyString(value.value)) {
    return undefined;
  }

  return { type: 'plain', value: value.value };
}

function validateModelDiscovery(path: string, value: unknown, issues: string[]): ProviderConfig['modelDiscovery'] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    issues.push(`${path} must be an object when present`);
    return undefined;
  }

  if (!isNonEmptyString(value.path) || !value.path.startsWith('/')) {
    issues.push(`${path}.path must be a non-empty string that must begin with /`);
    return undefined;
  }

  return { path: value.path };
}

function validateModels(path: string, value: unknown, issues: string[]): Record<string, ModelConfig> | undefined {
  if (!isRecord(value)) {
    issues.push(`${path} is required and must be an object with at least one model`);
    return undefined;
  }

  const modelEntries = Object.entries(value);
  if (modelEntries.length === 0) {
    issues.push(`${path} is required and must include at least one model`);
    return undefined;
  }

  const models: Record<string, ModelConfig> = {};

  for (const [modelId, modelValue] of modelEntries) {
    if (!isNonEmptyString(modelId)) {
      issues.push(`${path} must use non-empty model IDs`);
      continue;
    }

    const model = validateModelConfig(`${path}.${modelId}`, modelValue, issues);
    if (model !== undefined) {
      models[modelId] = model;
    }
  }

  return models;
}

function validateModelConfig(path: string, value: unknown, issues: string[]): ModelConfig | undefined {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }

  const model: ModelConfig = {};
  let valid = true;

  if (value.variant !== undefined) {
    if (!isNonEmptyString(value.variant)) {
      issues.push(`${path}.variant must be a non-empty string when present`);
      valid = false;
    } else {
      model.variant = value.variant;
    }
  }

  if (value.contextWindow !== undefined) {
    if (!isPositiveInteger(value.contextWindow)) {
      issues.push(`${path}.contextWindow must be a positive integer when present`);
      valid = false;
    } else {
      model.contextWindow = value.contextWindow;
    }
  }

  if (value.contextTokens !== undefined) {
    if (!isPositiveInteger(value.contextTokens)) {
      issues.push(`${path}.contextTokens must be a positive integer when present`);
      valid = false;
    } else {
      model.contextTokens = value.contextTokens;
    }
  }

  if (value.maxTokens !== undefined) {
    if (!isPositiveInteger(value.maxTokens)) {
      issues.push(`${path}.maxTokens must be a positive integer when present`);
      valid = false;
    } else {
      model.maxTokens = value.maxTokens;
    }
  }

  return valid ? model : undefined;
}

function validateOhMyOpenAgentConfig(value: unknown, providers: Record<string, ProviderConfig>, issues: string[]): OhMyOpenAgentConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const path = 'ohMyOpenAgent';
  if (!isRecord(value)) {
    issues.push(`${path} must be an object when present`);
    return undefined;
  }

  const agents = validateOhMyOpenAgentAssignments(
    `${path}.agents`,
    value.agents,
    providers,
    issues,
    new Set(OH_MY_OPENAGENT_AGENT_NAMES),
  ) as OhMyOpenAgentConfig['agents'];
  const categories = validateOhMyOpenAgentAssignments(
    `${path}.categories`,
    value.categories,
    providers,
    issues,
    new Set(OH_MY_OPENAGENT_CATEGORY_NAMES),
  ) as OhMyOpenAgentConfig['categories'];
  const config: OhMyOpenAgentConfig = {};

  if (agents !== undefined) {
    config.agents = agents;
  }
  if (categories !== undefined) {
    config.categories = categories;
  }

  return config.agents === undefined && config.categories === undefined ? undefined : config;
}

function validateOhMyOpenAgentAssignments(
  path: string,
  value: unknown,
  providers: Record<string, ProviderConfig>,
  issues: string[],
  allowedKeys: Set<string>,
): Record<string, OhMyOpenAgentModelAssignment> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    issues.push(`${path} must be an object when present`);
    return undefined;
  }

  const assignments: Record<string, OhMyOpenAgentModelAssignment> = {};

  for (const [key, assignmentValue] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(`${path}.${key} must use a supported OhMyOpenAgent name`);
      continue;
    }

    const assignment = validateOhMyOpenAgentAssignment(`${path}.${key}`, assignmentValue, providers, issues);
    if (assignment !== undefined) {
      assignments[key] = assignment;
    }
  }

  return Object.keys(assignments).length === 0 ? undefined : assignments;
}

function validateOhMyOpenAgentAssignment(
  path: string,
  value: unknown,
  providers: Record<string, ProviderConfig>,
  issues: string[],
): OhMyOpenAgentModelAssignment | undefined {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }

  if (!isNonEmptyString(value.model)) {
    issues.push(`${path}.model is required and must be a non-empty provider/model string`);
    return undefined;
  }

  const assignment: OhMyOpenAgentModelAssignment = { model: value.model };
  if (!isKnownProviderModelReference(value.model, providers)) {
    issues.push(`${path}.model must reference an existing providers.<provider>.models.<model> entry (received ${value.model})`);
  }

  if (value.variant !== undefined) {
    if (!isOhMyOpenAgentModelVariant(value.variant)) {
      issues.push(`${path}.variant must be one of ${OH_MY_OPENAGENT_MODEL_VARIANTS.join(', ')}`);
    } else {
      assignment.variant = value.variant;
    }
  }

  return assignment;
}

function isKnownProviderModelReference(value: string, providers: Record<string, ProviderConfig>): boolean {
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return false;
  }

  const providerId = value.slice(0, separatorIndex);
  const modelId = value.slice(separatorIndex + 1);
  return providers[providerId]?.models[modelId] !== undefined;
}

function isOhMyOpenAgentModelVariant(value: unknown): value is OhMyOpenAgentModelVariant {
  return typeof value === 'string' && (OH_MY_OPENAGENT_MODEL_VARIANTS as readonly string[]).includes(value);
}

function normalizeSchemaVersion(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }

  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatParserError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message.split('\n')[0];
  }

  return 'unknown parser error';
}
