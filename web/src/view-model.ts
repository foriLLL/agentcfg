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

export const MANAGED_FIELDS: ManagedField[] = ['provider', 'model', 'baseURL', 'apiKey'];

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
  if (state?.conflict.present) {
    return 'warning';
  }
  if (state?.cache.present) {
    return 'ready';
  }
  return 'pending';
}

export function statusLabel(state: RuntimeStateSummary | null): string {
  if (state?.conflict.present) {
    return '需要检查冲突';
  }
  if (state?.cache.present) {
    return '缓存已就绪';
  }
  if (state?.gist.present) {
    return '可以拉取';
  }
  return '需要设置';
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
  return {
    schemaVersion: config.schemaVersion,
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL,
    apiKey: {
      type: 'plain',
      value: config.apiKey.value,
    },
  };
}

export function buildRemoteYamlPreview(config: EditableAgentConfig): string {
  return [
    `schemaVersion: ${config.schemaVersion}`,
    `provider: ${yamlScalar(config.provider)}`,
    `model: ${yamlScalar(config.model)}`,
    `baseURL: ${yamlScalar(config.baseURL)}`,
    'apiKey:',
    `  type: ${yamlScalar(config.apiKey.type)}`,
    `  value: ${yamlScalar(config.apiKey.value)}`,
    '',
  ].join('\n');
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
  return field;
}

export function agentLabel(agent: AgentName): string {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
