import {
  OH_MY_OPENAGENT_AGENT_NAMES,
  OH_MY_OPENAGENT_CATEGORY_NAMES,
  OH_MY_OPENAGENT_MODEL_VARIANTS,
} from '../../../src/core/schema';
import type {
  EditableAgentConfig,
  OhMyOpenAgentModelAssignment,
  OhMyOpenAgentModelVariant,
} from '../api';

export type OhMyOpenAgentAssignmentKind = 'agents' | 'categories';

const PROVIDER_PROTOCOLS = ['openai-compatible', 'anthropic-compatible'] as const;

/**
 * Pure draft mutators for the remote agentcfg.yaml editor.
 *
 * App.tsx owns the editable draft state via useState; these helpers are
 * the only writers. Keeping them in a dedicated module lets App.tsx
 * stay focused on wiring (handlers + props) instead of pages of
 * recursion through the OhMyOpenAgent shape.
 */

export function providerDraft(
  config: EditableAgentConfig,
  providerId: string,
): EditableAgentConfig['providers'][string] {
  return config.providers[providerId] ?? emptyProviderDraft(config.defaults.model);
}

export function modelDraft(
  provider: EditableAgentConfig['providers'][string],
  modelId: string,
): EditableAgentConfig['providers'][string]['models'][string] {
  return provider.models[modelId] ?? {};
}

export function updateProviderDraft(
  config: EditableAgentConfig,
  providerId: string,
  updateProvider: (provider: EditableAgentConfig['providers'][string]) => EditableAgentConfig['providers'][string],
): EditableAgentConfig {
  return {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: updateProvider(providerDraft(config, providerId)),
    },
  };
}

export function updateModelDraft(
  config: EditableAgentConfig,
  providerId: string,
  modelId: string,
  updateModel: (
    model: EditableAgentConfig['providers'][string]['models'][string],
  ) => EditableAgentConfig['providers'][string]['models'][string],
): EditableAgentConfig {
  return updateProviderDraft(config, providerId, (provider) => ({
    ...provider,
    models: {
      ...provider.models,
      [modelId]: updateModel(modelDraft(provider, modelId)),
    },
  }));
}

export function renameProviderDraft(
  config: EditableAgentConfig,
  previousProviderId: string,
  nextProviderId: string,
): EditableAgentConfig {
  if (previousProviderId === nextProviderId) {
    return config;
  }
  if (config.providers[nextProviderId] !== undefined) {
    return config;
  }

  const provider = providerDraft(config, previousProviderId);
  const providers = { ...config.providers };
  delete providers[previousProviderId];
  providers[nextProviderId] = provider;

  return {
    ...config,
    defaults:
      config.defaults.provider === previousProviderId ? { ...config.defaults, provider: nextProviderId } : config.defaults,
    providers,
    ohMyOpenAgent: remapOhMyOpenAgentProviderReference(config.ohMyOpenAgent, previousProviderId, nextProviderId),
  };
}

export function renameModelDraft(
  config: EditableAgentConfig,
  providerId: string,
  previousModelId: string,
  nextModelId: string,
): EditableAgentConfig {
  if (previousModelId === nextModelId) {
    return config;
  }

  const provider = providerDraft(config, providerId);
  if (provider.models[nextModelId] !== undefined) {
    return config;
  }

  const model = modelDraft(provider, previousModelId);
  const models = { ...provider.models };
  delete models[previousModelId];
  models[nextModelId] = model;

  return {
    ...config,
    defaults:
      config.defaults.provider === providerId && config.defaults.model === previousModelId
        ? { ...config.defaults, model: nextModelId }
        : config.defaults,
    providers: {
      ...config.providers,
      [providerId]: { ...provider, models },
    },
    ohMyOpenAgent: remapOhMyOpenAgentModelReference(config.ohMyOpenAgent, providerId, previousModelId, nextModelId),
  };
}

export function buildRemoteModelReferenceOptions(config: EditableAgentConfig): string[] {
  return Object.entries(config.providers).flatMap(([providerId, provider]) =>
    Object.keys(provider.models).map((modelId) => `${providerId}/${modelId}`),
  );
}

export function withOhMyOpenAgentModel(
  config: EditableAgentConfig,
  kind: OhMyOpenAgentAssignmentKind,
  name: string,
  modelReference: string,
): EditableAgentConfig {
  if (modelReference === '') {
    return withOhMyOpenAgentAssignment(config, kind, name, undefined);
  }

  const currentAssignment = config.ohMyOpenAgent?.[kind]?.[name];
  return withOhMyOpenAgentAssignment(config, kind, name, {
    model: modelReference,
    ...(currentAssignment?.variant === undefined ? {} : { variant: currentAssignment.variant }),
  });
}

export function withOhMyOpenAgentVariant(
  config: EditableAgentConfig,
  kind: OhMyOpenAgentAssignmentKind,
  name: string,
  variant: string,
): EditableAgentConfig {
  const currentAssignment = config.ohMyOpenAgent?.[kind]?.[name];
  if (currentAssignment === undefined) {
    return config;
  }

  return withOhMyOpenAgentAssignment(config, kind, name, {
    model: currentAssignment.model,
    ...(variant === '' ? {} : { variant: normalizeOhMyOpenAgentVariant(variant) }),
  });
}

export function withOhMyOpenAgentAssignment(
  config: EditableAgentConfig,
  kind: OhMyOpenAgentAssignmentKind,
  name: string,
  assignment: OhMyOpenAgentModelAssignment | undefined,
): EditableAgentConfig {
  const existingConfig = config.ohMyOpenAgent ?? {};
  const assignments = { ...(existingConfig[kind] ?? {}) };

  if (assignment === undefined) {
    delete assignments[name];
  } else {
    assignments[name] = assignment;
  }

  const nextOhMyOpenAgent = compactOhMyOpenAgentConfig({
    ...existingConfig,
    ...(Object.keys(assignments).length === 0 ? { [kind]: undefined } : { [kind]: assignments }),
  });

  return {
    ...config,
    ...(nextOhMyOpenAgent === undefined ? { ohMyOpenAgent: undefined } : { ohMyOpenAgent: nextOhMyOpenAgent }),
  };
}

export function removeUnknownOhMyOpenAgentReferences(config: EditableAgentConfig): EditableAgentConfig {
  if (config.ohMyOpenAgent === undefined) {
    return config;
  }

  const knownReferences = new Set(buildRemoteModelReferenceOptions(config));
  const agents = filterKnownOhMyOpenAgentAssignments(config.ohMyOpenAgent.agents, knownReferences);
  const categories = filterKnownOhMyOpenAgentAssignments(config.ohMyOpenAgent.categories, knownReferences);
  const ohMyOpenAgent = compactOhMyOpenAgentConfig({ agents, categories });

  return {
    ...config,
    ...(ohMyOpenAgent === undefined ? { ohMyOpenAgent: undefined } : { ohMyOpenAgent }),
  };
}

export function emptyProviderDraft(modelId: string): EditableAgentConfig['providers'][string] {
  return {
    baseURL: '',
    apiKey: { type: 'plain', value: '' },
    models: { [modelId]: {} },
  };
}

export function uniqueDraftId(baseId: string, records: Record<string, unknown>): string {
  if (records[baseId] === undefined) {
    return baseId;
  }

  for (let index = 2; ; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (records[candidate] === undefined) {
      return candidate;
    }
  }
}

export function validateRemoteDraft(config: EditableAgentConfig): string | null {
  const providerEntries = Object.entries(config.providers);
  if (providerEntries.length === 0) {
    return '至少需要一个提供商。';
  }

  if (config.providers[config.defaults.provider] === undefined) {
    return '默认提供商必须指向已配置的提供商。';
  }

  if (config.providers[config.defaults.provider]?.models[config.defaults.model] === undefined) {
    return '默认模型必须属于默认提供商。';
  }

  for (const [providerId, provider] of providerEntries) {
    const providerLabel = providerId.trim() === '' ? '未命名提供商' : providerId;
    if (providerId.trim() === '') {
      return '提供商 ID 不能为空。';
    }
    if (providerId.includes('/')) {
      return `${providerLabel} 的提供商 ID 不能包含 /，因为 OhMyOpenAgent model 使用 provider/model 引用格式。`;
    }
    if (provider.baseURL.trim() === '') {
      return `${providerLabel} 的 Base URL 不能为空。`;
    }
    if (provider.protocol !== undefined && !(PROVIDER_PROTOCOLS as readonly string[]).includes(provider.protocol)) {
      return `${providerLabel} 的协议必须是 openai-compatible 或 anthropic-compatible。`;
    }
    if (provider.apiKey.value.trim() === '') {
      return `${providerLabel} 的 API Key 不能为空；Web 页面不隐藏或沿用不可见密钥。`;
    }
    if (provider.modelDiscovery !== undefined && (provider.modelDiscovery.path.trim() === '' || !provider.modelDiscovery.path.startsWith('/'))) {
      return `${providerLabel} 的模型发现路径必须留空或以 / 开头。`;
    }

    const modelEntries = Object.entries(provider.models);
    if (modelEntries.length === 0) {
      return `${providerLabel} 至少需要一个模型。`;
    }

    for (const [modelId, model] of modelEntries) {
      const modelLabel = modelId.trim() === '' ? '未命名模型' : modelId;
      if (modelId.trim() === '') {
        return `${providerLabel} 的模型 ID 不能为空。`;
      }
      if (model.variant !== undefined && model.variant.trim() === '') {
        return `${providerLabel}/${modelLabel} 的 variant 必须留空或填写非空文本。`;
      }
      for (const field of ['contextWindow', 'contextTokens', 'maxTokens'] as const) {
        if (model[field] !== undefined && (!Number.isInteger(model[field]) || (model[field] as number) <= 0)) {
          return `${providerLabel}/${modelLabel} 的 ${field} 必须留空或填写正整数。`;
        }
      }
      if (model.supportsVision !== undefined && typeof model.supportsVision !== 'boolean') {
        return `${providerLabel}/${modelLabel} 的 supportsVision 必须留空或填写布尔值。`;
      }
    }
  }

  const ohMyOpenAgentValidation = validateOhMyOpenAgentDraft(config);
  if (ohMyOpenAgentValidation !== null) {
    return ohMyOpenAgentValidation;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported because every caller goes through the
// public mutators above)
// ---------------------------------------------------------------------------

function remapOhMyOpenAgentProviderReference(
  config: EditableAgentConfig['ohMyOpenAgent'],
  previousProviderId: string,
  nextProviderId: string,
): EditableAgentConfig['ohMyOpenAgent'] {
  return compactOhMyOpenAgentConfig({
    agents: remapOhMyOpenAgentAssignments(config?.agents, (assignment) =>
      remapProviderModelReference(assignment, `${previousProviderId}/`, `${nextProviderId}/`),
    ),
    categories: remapOhMyOpenAgentAssignments(config?.categories, (assignment) =>
      remapProviderModelReference(assignment, `${previousProviderId}/`, `${nextProviderId}/`),
    ),
  });
}

function remapOhMyOpenAgentModelReference(
  config: EditableAgentConfig['ohMyOpenAgent'],
  providerId: string,
  previousModelId: string,
  nextModelId: string,
): EditableAgentConfig['ohMyOpenAgent'] {
  const previousReference = `${providerId}/${previousModelId}`;
  const nextReference = `${providerId}/${nextModelId}`;
  return compactOhMyOpenAgentConfig({
    agents: remapOhMyOpenAgentAssignments(config?.agents, (assignment) =>
      assignment.model === previousReference ? { ...assignment, model: nextReference } : assignment,
    ),
    categories: remapOhMyOpenAgentAssignments(config?.categories, (assignment) =>
      assignment.model === previousReference ? { ...assignment, model: nextReference } : assignment,
    ),
  });
}

function remapProviderModelReference(
  assignment: OhMyOpenAgentModelAssignment,
  previousPrefix: string,
  nextPrefix: string,
): OhMyOpenAgentModelAssignment {
  return assignment.model.startsWith(previousPrefix)
    ? { ...assignment, model: `${nextPrefix}${assignment.model.slice(previousPrefix.length)}` }
    : assignment;
}

function remapOhMyOpenAgentAssignments(
  assignments: Record<string, OhMyOpenAgentModelAssignment> | undefined,
  remapAssignment: (assignment: OhMyOpenAgentModelAssignment) => OhMyOpenAgentModelAssignment,
): Record<string, OhMyOpenAgentModelAssignment> | undefined {
  if (assignments === undefined) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(assignments).map(([name, assignment]) => [name, remapAssignment(assignment)]),
  );
}

function filterKnownOhMyOpenAgentAssignments(
  assignments: Record<string, OhMyOpenAgentModelAssignment> | undefined,
  knownReferences: Set<string>,
): Record<string, OhMyOpenAgentModelAssignment> | undefined {
  if (assignments === undefined) {
    return undefined;
  }

  const filteredAssignments = Object.fromEntries(
    Object.entries(assignments).filter(([, assignment]) => knownReferences.has(assignment.model)),
  );
  return Object.keys(filteredAssignments).length === 0 ? undefined : filteredAssignments;
}

function compactOhMyOpenAgentConfig(
  config: EditableAgentConfig['ohMyOpenAgent'],
): EditableAgentConfig['ohMyOpenAgent'] {
  const agents = config?.agents === undefined || Object.keys(config.agents).length === 0 ? undefined : config.agents;
  const categories =
    config?.categories === undefined || Object.keys(config.categories).length === 0 ? undefined : config.categories;

  if (agents === undefined && categories === undefined) {
    return undefined;
  }

  return {
    ...(agents === undefined ? {} : { agents }),
    ...(categories === undefined ? {} : { categories }),
  };
}

function normalizeOhMyOpenAgentVariant(variant: string): OhMyOpenAgentModelVariant | undefined {
  return (OH_MY_OPENAGENT_MODEL_VARIANTS as readonly string[]).includes(variant)
    ? (variant as OhMyOpenAgentModelVariant)
    : undefined;
}

function validateOhMyOpenAgentDraft(config: EditableAgentConfig): string | null {
  if (config.ohMyOpenAgent === undefined) {
    return null;
  }

  const knownReferences = new Set(buildRemoteModelReferenceOptions(config));
  const allowedAgentNames = new Set<string>(OH_MY_OPENAGENT_AGENT_NAMES);
  const allowedCategoryNames = new Set<string>(OH_MY_OPENAGENT_CATEGORY_NAMES);
  const variantNames = new Set<string>(OH_MY_OPENAGENT_MODEL_VARIANTS);
  const groups: Array<{
    assignments: Record<string, OhMyOpenAgentModelAssignment> | undefined;
    allowedNames: Set<string>;
    label: string;
  }> = [
    { assignments: config.ohMyOpenAgent.agents, allowedNames: allowedAgentNames, label: 'agent' },
    { assignments: config.ohMyOpenAgent.categories, allowedNames: allowedCategoryNames, label: 'task category' },
  ];

  for (const group of groups) {
    for (const [name, assignment] of Object.entries(group.assignments ?? {})) {
      if (!group.allowedNames.has(name)) {
        return `OhMyOpenAgent ${group.label} "${name}" 不是当前支持的官方名称。`;
      }
      if (!knownReferences.has(assignment.model)) {
        return `OhMyOpenAgent ${group.label} "${name}" 的模型必须来自当前 providers 模型目录。`;
      }
      if (assignment.variant !== undefined && !variantNames.has(assignment.variant)) {
        return `OhMyOpenAgent ${group.label} "${name}" 的 variant 必须是 max、high、medium、low 或 xhigh。`;
      }
    }
  }

  return null;
}
