export type AgentConfigSchemaFieldPath =
  | 'schemaVersion'
  | 'defaults'
  | 'defaults.provider'
  | 'defaults.model'
  | 'providers'
  | 'providers.<provider>'
  | 'providers.<provider>.baseURL'
  | 'providers.<provider>.apiKey'
  | 'providers.<provider>.apiKey.type'
  | 'providers.<provider>.apiKey.value'
  | 'providers.<provider>.modelDiscovery'
  | 'providers.<provider>.modelDiscovery.path'
  | 'providers.<provider>.models'
  | 'providers.<provider>.models.<model>'
  | 'providers.<provider>.models.<model>.variant'
  | 'providers.<provider>.models.<model>.contextWindow'
  | 'providers.<provider>.models.<model>.contextTokens'
  | 'providers.<provider>.models.<model>.maxTokens';

export type AgentConfigSchemaDoc = {
  path: AgentConfigSchemaFieldPath;
  label: string;
  type: string;
  required: boolean;
  description: string;
};

export const AGENTCFG_SCHEMA_DOCS: readonly AgentConfigSchemaDoc[] = [
  {
    path: 'schemaVersion',
    label: 'schemaVersion 版本',
    type: '1',
    required: true,
    description: '规范 agentcfg.yaml 格式版本。目前支持值为 1，且必须在解析原生 Agent 配置前提供。',
  },
  {
    path: 'defaults',
    label: '默认项',
    type: 'object',
    required: true,
    description: '应用 Agent 配置时使用的默认提供商与模型选择。',
  },
  {
    path: 'defaults.provider',
    label: '默认提供商',
    type: 'non-empty string',
    required: true,
    description: '从 providers 中选择的提供商 ID。该值必须匹配一个已配置的 provider key。',
  },
  {
    path: 'defaults.model',
    label: '默认模型',
    type: 'non-empty string',
    required: true,
    description: '从默认提供商 models 中选择的模型 ID。该值必须匹配 defaults.provider 下的一个已配置 model key。',
  },
  {
    path: 'providers',
    label: '提供商目录',
    type: 'object',
    required: true,
    description: '按非空提供商 ID 索引的提供商目录。至少需要一个提供商。',
  },
  {
    path: 'providers.<provider>',
    label: '提供商配置',
    type: 'object',
    required: true,
    description: '单个提供商的配置，包括端点、明文可见的 API Key、可选模型发现路径与模型目录。',
  },
  {
    path: 'providers.<provider>.baseURL',
    label: '提供商 Base URL',
    type: 'non-empty string',
    required: true,
    description: '提供商 API Base URL，例如 https://api.openai.com/v1。该值会写入目标 Agent 的提供商端点设置。',
  },
  {
    path: 'providers.<provider>.apiKey',
    label: '提供商 API Key 对象',
    type: 'object',
    required: true,
    description: '承载提供商 API Key 表示方式的对象。不接受字符串简写。',
  },
  {
    path: 'providers.<provider>.apiKey.type',
    label: '提供商 API Key 类型',
    type: 'plain',
    required: true,
    description: 'plain 表示提供商 API Key 以明文存储在 agentcfg.yaml 中，并按原值写入目标 Agent 配置。',
  },
  {
    path: 'providers.<provider>.apiKey.value',
    label: '提供商 API Key 值',
    type: 'non-empty string',
    required: true,
    description: '此提供商明文可见的 API Key 值。可信本地 agentcfg 界面会直接显示提供商 API Key，并将其作为托管 API Key 写入。',
  },
  {
    path: 'providers.<provider>.modelDiscovery',
    label: '模型发现',
    type: 'object',
    required: false,
    description: '可选的提供商模型发现配置。',
  },
  {
    path: 'providers.<provider>.modelDiscovery.path',
    label: '模型发现路径',
    type: 'absolute path string',
    required: false,
    description: '可选的提供商相对发现路径。提供时必须是以 / 开头的非空字符串。',
  },
  {
    path: 'providers.<provider>.models',
    label: '提供商模型目录',
    type: 'object',
    required: true,
    description: '按非空模型 ID 索引的模型目录。每个提供商必须定义至少一个模型。',
  },
  {
    path: 'providers.<provider>.models.<model>',
    label: '模型配置',
    type: 'object',
    required: false,
    description: '单个模型的配置元数据。空对象是有效值。',
  },
  {
    path: 'providers.<provider>.models.<model>.variant',
    label: '模型 variant',
    type: 'non-empty string',
    required: false,
    description: '可选的模型 variant 元数据，例如 chat。提供时必须是非空字符串。',
  },
  {
    path: 'providers.<provider>.models.<model>.contextWindow',
    label: '模型 contextWindow',
    type: 'positive integer',
    required: false,
    description: '可选的模型上下文窗口 token 数。提供时必须是正整数。',
  },
  {
    path: 'providers.<provider>.models.<model>.contextTokens',
    label: '模型 contextTokens',
    type: 'positive integer',
    required: false,
    description: '可选的模型运行时输入 token 预算。提供时必须是正整数。',
  },
  {
    path: 'providers.<provider>.models.<model>.maxTokens',
    label: '模型 maxTokens',
    type: 'positive integer',
    required: false,
    description: '可选的模型最大输出 token 数。提供时必须是正整数。',
  },
];
