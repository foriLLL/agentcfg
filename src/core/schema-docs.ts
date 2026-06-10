export type AgentConfigSchemaFieldPath =
  | 'schemaVersion'
  | 'provider'
  | 'model'
  | 'baseURL'
  | 'apiKey'
  | 'apiKey.type'
  | 'apiKey.value';

export type AgentConfigSchemaDoc = {
  path: AgentConfigSchemaFieldPath;
  label: string;
  type: string;
  required: true;
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
    path: 'provider',
    label: 'Provider',
    type: 'non-empty string',
    required: true,
    description: 'Provider identifier used by target agents, such as openai. This value is copied into managed provider fields in native agent configs.',
  },
  {
    path: 'model',
    label: 'Model',
    type: 'non-empty string',
    required: true,
    description: 'Model name to configure for each managed agent. The value is written to target model fields during apply.',
  },
  {
    path: 'baseURL',
    label: 'Base URL',
    type: 'non-empty URL string',
    required: true,
    description: 'Provider API base URL, for example https://api.openai.com/v1. It is written to the target agent provider endpoint setting.',
  },
  {
    path: 'apiKey',
    label: 'API key object',
    type: 'object',
    required: true,
    description: 'Container for the provider API key representation. The canonical object keeps the key type and value explicit in agentcfg.yaml.',
  },
  {
    path: 'apiKey.type',
    label: 'API key type',
    type: 'plain',
    required: true,
    description: 'plain means a plaintext provider API key stored in agentcfg.yaml and written verbatim to target agent configs.',
  },
  {
    path: 'apiKey.value',
    label: 'API key value',
    type: 'non-empty string',
    required: true,
    description: 'The provider API key value for the selected provider. It is intentionally visible in provider-key UI surfaces and is written as the managed API key.',
  },
];
