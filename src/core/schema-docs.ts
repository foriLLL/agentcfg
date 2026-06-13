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
    label: 'Schema version',
    type: '1',
    required: true,
    description: 'Canonical agentcfg.yaml format version. The current supported value is 1 and it must be present before native agent config parsing starts.',
  },
  {
    path: 'defaults',
    label: 'Defaults',
    type: 'object',
    required: true,
    description: 'Default provider and model selection used when applying agent configuration.',
  },
  {
    path: 'defaults.provider',
    label: 'Default provider',
    type: 'non-empty string',
    required: true,
    description: 'Provider ID selected from providers. It must match one configured provider key.',
  },
  {
    path: 'defaults.model',
    label: 'Default model',
    type: 'non-empty string',
    required: true,
    description: 'Model ID selected from the default provider models. It must match one configured model key under defaults.provider.',
  },
  {
    path: 'providers',
    label: 'Providers',
    type: 'object',
    required: true,
    description: 'Provider catalog keyed by non-empty provider IDs. At least one provider is required.',
  },
  {
    path: 'providers.<provider>',
    label: 'Provider config',
    type: 'object',
    required: true,
    description: 'Configuration for one provider, including its endpoint, visible API key, optional model discovery path, and model catalog.',
  },
  {
    path: 'providers.<provider>.baseURL',
    label: 'Provider base URL',
    type: 'non-empty string',
    required: true,
    description: 'Provider API base URL, for example https://api.openai.com/v1. It is written to the target agent provider endpoint setting.',
  },
  {
    path: 'providers.<provider>.apiKey',
    label: 'Provider API key object',
    type: 'object',
    required: true,
    description: 'Container for the provider API key representation. String shorthand is not accepted.',
  },
  {
    path: 'providers.<provider>.apiKey.type',
    label: 'Provider API key type',
    type: 'plain',
    required: true,
    description: 'plain means a plaintext provider API key stored in agentcfg.yaml and written verbatim to target agent configs.',
  },
  {
    path: 'providers.<provider>.apiKey.value',
    label: 'Provider API key value',
    type: 'non-empty string',
    required: true,
    description: 'The visible provider API key value for this provider. Trusted-local agentcfg surfaces show provider API key values and write them as managed API keys.',
  },
  {
    path: 'providers.<provider>.modelDiscovery',
    label: 'Model discovery',
    type: 'object',
    required: false,
    description: 'Optional provider model discovery configuration.',
  },
  {
    path: 'providers.<provider>.modelDiscovery.path',
    label: 'Model discovery path',
    type: 'absolute path string',
    required: false,
    description: 'Optional provider-relative discovery path. When present, it must be a non-empty string beginning with /.',
  },
  {
    path: 'providers.<provider>.models',
    label: 'Provider models',
    type: 'object',
    required: true,
    description: 'Model catalog keyed by non-empty model IDs. Each provider must define at least one model.',
  },
  {
    path: 'providers.<provider>.models.<model>',
    label: 'Model config',
    type: 'object',
    required: false,
    description: 'Configuration metadata for one model. Empty objects are valid.',
  },
  {
    path: 'providers.<provider>.models.<model>.variant',
    label: 'Model variant',
    type: 'non-empty string',
    required: false,
    description: 'Optional model variant metadata, such as chat. When present, it must be a non-empty string.',
  },
  {
    path: 'providers.<provider>.models.<model>.contextWindow',
    label: 'Model context window',
    type: 'positive integer',
    required: false,
    description: 'Optional model context window token count. When present, it must be a positive integer.',
  },
  {
    path: 'providers.<provider>.models.<model>.contextTokens',
    label: 'Model runtime context tokens',
    type: 'positive integer',
    required: false,
    description: 'Optional model runtime context token budget. When present, it must be a positive integer.',
  },
  {
    path: 'providers.<provider>.models.<model>.maxTokens',
    label: 'Model maximum output tokens',
    type: 'positive integer',
    required: false,
    description: 'Optional model maximum output token count. When present, it must be a positive integer.',
  },
];
