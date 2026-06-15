import {
  RuntimeClientError,
  type AgentConfig,
  type AgentName,
  type ApplyAgentResult,
  type EditableAgentConfig,
  type ManagedDiffChange,
  type ManagedField,
  type RuntimeStateSummary,
} from './api';

export type StepState = 'ready' | 'pending' | 'locked';

export type Step = {
  title: string;
  copy: string;
  state: StepState;
};

export const MANAGED_FIELDS: ManagedField[] = ['provider', 'model', 'baseURL', 'apiKey', 'contextWindow', 'contextTokens', 'maxTokens'];

const REMOTE_ACCESS_WARNING_COPY = '局域网设备可能访问并读写本机 Agent 配置。仅在可信网络中使用。';

export function buildSetupSteps(state: RuntimeStateSummary | null): Step[] {
  return [
    {
      title: '连接状态',
      copy: state?.gist.present ? '此本地会话已知道要使用的私有 Gist。' : '保存 CLI 使用的私有 Gist ID。',
      state: state?.gist.present ? 'ready' : 'pending',
    },
    {
      title: '拉取缓存',
      copy: state?.cache.present ? '远端配置已在本地缓存，并显示为完整值。' : '从 Gist 拉取以填充控制台缓存。',
      state: state?.cache.present ? 'ready' : 'pending',
    },
    {
      title: '审阅变更',
      copy: state?.cache.present ? '选择目标后即可执行 diff、dry-run 与应用。' : '拉取缓存后才会解锁审阅。',
      state: state?.cache.present ? 'pending' : 'locked',
    },
  ];
}

export function statusTone(state: RuntimeStateSummary | null): 'ready' | 'pending' | 'warning' {
  if (state?.cache.present) {
    return 'ready';
  }
  return 'pending';
}

export function statusLabel(state: RuntimeStateSummary | null): string {
  if (state?.cache.present) {
    return '缓存已就绪';
  }
  if (state?.gist.present) {
    return '可以拉取';
  }
  return '需要设置';
}

export function remoteAccessWarningForHostname(hostname: string | undefined): string | null {
  if (hostname === undefined || hostname.trim() === '') {
    return null;
  }

  const normalizedHostname = normalizeHostname(hostname);
  if (normalizedHostname === '127.0.0.1' || normalizedHostname === 'localhost' || normalizedHostname === '::1') {
    return null;
  }

  return `当前浏览器正在通过非本机回环地址 ${hostname} 访问 agentcfg Web API，${REMOTE_ACCESS_WARNING_COPY}`;
}

export function formatDate(value: string | undefined): string {
  if (value === undefined) {
    return '不可用';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function configToDraft(config: AgentConfig): EditableAgentConfig {
  const ohMyOpenAgent = config.ohMyOpenAgent === undefined ? undefined : cloneOhMyOpenAgentConfig(config.ohMyOpenAgent);

  return {
    schemaVersion: config.schemaVersion,
    defaults: { ...config.defaults },
    providers: cloneProviders(config.providers),
    ...(ohMyOpenAgent === undefined ? {} : { ohMyOpenAgent }),
  };
}

export function buildRemoteYamlPreview(config: EditableAgentConfig): string {
  const lines = [
    `schemaVersion: ${config.schemaVersion}`,
    'defaults:',
    `  provider: ${yamlScalar(config.defaults.provider)}`,
    `  model: ${yamlScalar(config.defaults.model)}`,
    'providers:',
  ];

  for (const [providerId, provider] of Object.entries(config.providers)) {
    lines.push(
      `  ${yamlScalar(providerId)}:`,
      `    baseURL: ${yamlScalar(provider.baseURL)}`,
      '    apiKey:',
      `      type: ${yamlScalar(provider.apiKey.type)}`,
      `      value: ${yamlScalar(provider.apiKey.value)}`,
    );

    if (provider.modelDiscovery !== undefined) {
      lines.push('    modelDiscovery:', `      path: ${yamlScalar(provider.modelDiscovery.path)}`);
    }

    lines.push('    models:');

    for (const [modelId, model] of Object.entries(provider.models)) {
      lines.push(`      ${yamlScalar(modelId)}:${modelLines(model)}`);
    }
  }

  const hasOhMyOpenAgentAgents = config.ohMyOpenAgent?.agents !== undefined && Object.keys(config.ohMyOpenAgent.agents).length > 0;
  const hasOhMyOpenAgentCategories = config.ohMyOpenAgent?.categories !== undefined && Object.keys(config.ohMyOpenAgent.categories).length > 0;

  if (hasOhMyOpenAgentAgents || hasOhMyOpenAgentCategories) {
    lines.push('ohMyOpenAgent:');

    if (hasOhMyOpenAgentAgents) {
      lines.push('  agents:');
      appendOhMyOpenAgentAssignments(lines, config.ohMyOpenAgent?.agents ?? {}, 4);
    }

    if (hasOhMyOpenAgentCategories) {
      lines.push('  categories:');
      appendOhMyOpenAgentAssignments(lines, config.ohMyOpenAgent?.categories ?? {}, 4);
    }
  }

  lines.push('');

  return lines.join('\n');
}

export function formatError(error: unknown): string {
  if (error instanceof RuntimeClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '发生意外运行时错误。';
}

export function formatManagedValue(change: ManagedDiffChange | undefined, side: 'current' | 'expected'): string {
  if (change === undefined) {
    return '无变化';
  }
  const value = side === 'current' ? change.current : change.expected;
  return value ?? '未设置';
}

export function formatStatus(status: ApplyAgentResult['status'] | undefined): string {
  if (status === undefined) {
    return '未返回';
  }
  if (status === 'would-change') {
    return '将会变更';
  }
  if (status === 'applied') {
    return '已应用';
  }
  if (status === 'unchanged') {
    return '无变化';
  }
  if (status === 'failed') {
    return '失败';
  }
  if (status === 'cancelled') {
    return '已取消';
  }
  return status;
}

export function formatFileMode(mode: number): string {
  return `mode ${mode.toString(8).padStart(4, '0')}`;
}

export function fieldLabel(field: ManagedField): string {
  if (field === 'baseURL') {
    return 'Base URL';
  }
  if (field === 'apiKey') {
    return 'API 密钥';
  }
  if (field === 'provider') {
    return '提供方';
  }
  if (field === 'model') {
    return '模型';
  }
  if (field === 'contextWindow') {
    return 'Limit Context（上下文窗口）';
  }
  if (field === 'contextTokens') {
    return 'Limit Input（输入预算）';
  }
  if (field === 'maxTokens') {
    return 'Limit Output（输出上限）';
  }
  return field;
}

export function agentLabel(agent: AgentName): string {
  if (agent === 'claude') {
    return 'Claude Code';
  }
  if (agent === 'opencode') {
    return 'OpenCode';
  }
  if (agent === 'openclaw') {
    return 'OpenClaw';
  }
  return 'Codex';
}

export function extractApplyResults(error: unknown): ApplyAgentResult[] | undefined {
  if (!(error instanceof RuntimeClientError) || !isRecord(error.details)) {
    return undefined;
  }
  const results = error.details.results;
  return Array.isArray(results) ? (results as ApplyAgentResult[]) : undefined;
}

function yamlScalar(value: string): string {
  if (value === '') {
    return '""';
  }
  return JSON.stringify(value);
}

function cloneProviders(providers: AgentConfig['providers']): EditableAgentConfig['providers'] {
  const draftProviders: EditableAgentConfig['providers'] = {};

  for (const [providerId, provider] of Object.entries(providers)) {
    const models: EditableAgentConfig['providers'][string]['models'] = {};

    for (const [modelId, model] of Object.entries(provider.models)) {
      models[modelId] = { ...model };
    }

    draftProviders[providerId] = {
      baseURL: provider.baseURL,
      apiKey: {
        type: 'plain',
        value: provider.apiKey.value,
      },
      models,
    };

    if (provider.modelDiscovery !== undefined) {
      draftProviders[providerId].modelDiscovery = { path: provider.modelDiscovery.path };
    }
  }

  return draftProviders;
}

function cloneOhMyOpenAgentConfig(config: NonNullable<AgentConfig['ohMyOpenAgent']>): EditableAgentConfig['ohMyOpenAgent'] {
  const agents = cloneOhMyOpenAgentAssignments(config.agents);
  const categories = cloneOhMyOpenAgentAssignments(config.categories);

  if (agents === undefined && categories === undefined) {
    return undefined;
  }

  return {
    ...(agents === undefined ? {} : { agents }),
    ...(categories === undefined ? {} : { categories }),
  };
}

function cloneOhMyOpenAgentAssignments(assignments: NonNullable<AgentConfig['ohMyOpenAgent']>['agents']): Record<string, { model: string; variant?: 'max' | 'high' | 'medium' | 'low' | 'xhigh' }> | undefined {
  const cloned: Record<string, { model: string; variant?: 'max' | 'high' | 'medium' | 'low' | 'xhigh' }> = {};

  for (const [key, assignment] of Object.entries(assignments ?? {})) {
    cloned[key] = { ...assignment };
  }

  return Object.keys(cloned).length === 0 ? undefined : cloned;
}

function appendOhMyOpenAgentAssignments(lines: string[], assignments: Record<string, { model: string; variant?: string }>, indent: number): void {
  const baseIndent = ' '.repeat(indent);
  const fieldIndent = ' '.repeat(indent + 2);

  for (const [name, assignment] of Object.entries(assignments)) {
    lines.push(`${baseIndent}${yamlScalar(name)}:`, `${fieldIndent}model: ${yamlScalar(assignment.model)}`);
    if (assignment.variant !== undefined) {
      lines.push(`${fieldIndent}variant: ${yamlScalar(assignment.variant)}`);
    }
  }
}

function modelLines(model: EditableAgentConfig['providers'][string]['models'][string]): string {
  const lines: string[] = [];

  if (model.variant !== undefined) {
    lines.push(`        variant: ${yamlScalar(model.variant)}`);
  }

  if (model.contextWindow !== undefined) {
    lines.push(`        contextWindow: ${model.contextWindow}`);
  }

  if (model.contextTokens !== undefined) {
    lines.push(`        contextTokens: ${model.contextTokens}`);
  }

  if (model.maxTokens !== undefined) {
    lines.push(`        maxTokens: ${model.maxTokens}`);
  }

  if (lines.length === 0) {
    return ' {}';
  }

  return `\n${lines.join('\n')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeHostname(hostname: string): string {
  const trimmedHostname = hostname.trim().toLowerCase();
  if (trimmedHostname.startsWith('[') && trimmedHostname.endsWith(']')) {
    return trimmedHostname.slice(1, -1);
  }
  return trimmedHostname;
}
