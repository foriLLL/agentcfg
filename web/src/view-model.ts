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
const LOCAL_REVIEW_ACTION_COPY = '预览变更与应用都会使用当前选择的本地配置目标和路径覆盖。';

export function buildSetupSteps(state: RuntimeStateSummary | null): Step[] {
  return [
    {
      title: '连接配置源',
      copy: state?.cache.present
        ? '配置源的 agentcfg.yaml 已缓存到本地。'
        : state?.gist.present
          ? '已连接 Gist，等待拉取配置。'
          : '保存 GitHub Token 或 Gist ID 后即可连接。',
      state: state?.cache.present ? 'ready' : 'pending',
    },
    {
      title: '执行同步',
      copy: state?.cache.present
        ? '选择目标后预览变更，确认后即可应用。'
        : '拉取配置后才能运行预览变更与应用。',
      state: state?.cache.present ? 'pending' : 'locked',
    },
    {
      title: '设置自动同步',
      copy: state?.autoSync?.enabled === true
        ? `已启用自动同步，每 ${state.autoSync.intervalMinutes} 分钟运行一次。`
        : '完成首次同步后，可在设置页配置后台策略。',
      state: state?.autoSync?.enabled === true ? 'ready' : 'pending',
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

export function agentSupportsManagedFieldDiff(agent: AgentName): boolean {
  return agent !== 'ohmyopenagent';
}

export function localReviewActionCopyForAgent(_agent: AgentName | null): string {
  return LOCAL_REVIEW_ACTION_COPY;
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
    return formatRuntimeClientError(error);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '发生意外运行时错误。';
}

export function formatRuntimeClientError(error: RuntimeClientError): string {
  const message = error.message.trim() === '' ? '运行时没有返回错误详情。' : error.message.trim();
  const nextAction = nextActionForRuntimeError(error, message);
  return `原因：${message} 下一步：${nextAction}`;
}

export function formatRemoteValidationError(message: string): string {
  const cause = message.trim() === '' ? '远端配置未通过 agentcfg.yaml schema 校验。' : message.trim();
  return `原因：${cause} 下一步：按提示修正 schema、provider、model 或必填字段后再保存。`;
}

function nextActionForRuntimeError(error: RuntimeClientError, message: string): string {
  if (error.code === 'gist-error') {
    if (/401|403|bad credentials|Resource not accessible|token/i.test(message)) {
      return '确认 GitHub Token 仍有效并包含 gist 权限，然后重新连接；如果目标 Gist 已被删除，请重新创建或填写新的 Gist ID。';
    }
    if (/404|not found/i.test(message)) {
      return '确认 Gist ID 没有填错且 Gist 未被删除；必要时返回配置页重新创建远端配置。';
    }
    return '检查网络与 GitHub Gist 权限后重试；远端不可用时本地文件不会被写入。';
  }

  if (error.code === 'validation-error') {
    return '按提示修正 agentcfg.yaml 的 schema、provider、model 或必填字段后再保存/拉取。';
  }

  if (error.code === 'provider-error') {
    return '检查 Provider Base URL、模型发现路径和 API Key；这只影响模型发现，不会自动修改本地配置。';
  }

  if (error.code === 'cache-refresh-error') {
    return '远端保存可能已经成功，请修复本地状态路径权限或磁盘问题后重新刷新缓存，避免继续使用旧缓存。';
  }

  if (error.code === 'state-error' && /No cached agentcfg\.yaml/i.test(message)) {
    return '先在配置页连接或保存远端配置，确保本地缓存存在，再运行预览、应用或自动同步。';
  }

  if (error.code === 'apply-error') {
    if (hasApplyResults(error)) {
      return '查看下方每个目标的失败原因；已成功或无变化的目标会保留各自状态，修复失败目标后重新预览并应用。';
    }
    if (/permission|EACCES|EPERM|read-only|Refusing to write/i.test(message)) {
      return '检查本地配置文件或目录权限，确保当前用户可写，再重新预览并应用。';
    }
    return '修复本地配置文件、路径或权限问题后重新预览；失败时不会隐藏备份路径或错误详情。';
  }

  if (error.code === 'invalid-request' && /githubToken is required/i.test(message)) {
    return '粘贴带 gist 权限的 GitHub Token，或在设置中保存 Token 后重试。';
  }

  if (error.code === 'invalid-request') {
    return '检查当前表单输入和目标选择，修正后重试。';
  }

  return '根据错误详情修正输入或本地环境后重试。';
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
    return '无变化（无需写入）';
  }
  if (status === 'failed') {
    return '失败';
  }
  if (status === 'cancelled') {
    return '已取消';
  }
  return status;
}

export function applyResultNextAction(result: ApplyAgentResult): string | undefined {
  if (result.status !== 'failed') {
    return undefined;
  }
  const error = result.error ?? '';
  if (/permission|EACCES|EPERM|read-only|Refusing to write/i.test(error)) {
    return '检查该目标配置文件和关联 Env 文件的写入权限，然后重新预览并应用。';
  }
  if (/Missing .* native config|ENOENT|not found/i.test(error)) {
    return '创建缺失的原生配置文件，或在路径输入框填写已有配置文件后重新预览。';
  }
  if (/parser|valid|schema|unsupported|ambiguous/i.test(error)) {
    return '修正该目标原生配置格式或 agentcfg schema 后重新预览。';
  }
  return '按失败原因修复该目标后重新预览并应用；其他目标的状态已在各自卡片中保留。';
}

export function applyResultsAreNoOp(results: readonly ApplyAgentResult[]): boolean {
  return results.length > 0 && results.every((result) => result.status === 'unchanged');
}

export function formatFileMode(mode: number): string {
  return `mode ${mode.toString(8).padStart(4, '0')}`;
}

export function fieldLabel(field: ManagedField): string {
  const ohMyOpenAgentLabel = ohMyOpenAgentFieldLabel(field);
  if (ohMyOpenAgentLabel !== null) {
    return ohMyOpenAgentLabel;
  }
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
  if (agent === 'ohmyopenagent') {
    return 'OhMyOpenAgent';
  }
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

function ohMyOpenAgentFieldLabel(field: ManagedField): string | null {
  if (!field.startsWith('ohMyOpenAgent.')) {
    return null;
  }

  const segments = field.split('.');
  if (segments.length !== 4) {
    return field;
  }

  const [, group, name, leaf] = segments;
  const groupLabel = group === 'agents' ? 'Agent' : group === 'categories' ? 'Category' : group;
  const leafLabel = leaf === 'model' ? '模型' : leaf === 'variant' ? 'Variant' : leaf;
  return `OhMyOpenAgent ${groupLabel} ${name} ${leafLabel}`;
}

export function extractApplyResults(error: unknown): ApplyAgentResult[] | undefined {
  if (!hasApplyResults(error)) {
    return undefined;
  }
  return error.details.results as ApplyAgentResult[];
}

function hasApplyResults(error: unknown): error is RuntimeClientError & { details: { results: ApplyAgentResult[] } } {
  if (!(error instanceof RuntimeClientError) || !isRecord(error.details)) {
    return false;
  }
  return Array.isArray(error.details.results);
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
