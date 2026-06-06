import type { CanonicalAgentConfig } from './schema';

export const MASKED_SECRET = '***MASKED***';

export function maskSecret(_secret: string): typeof MASKED_SECRET {
  return MASKED_SECRET;
}

export type MaskedAgentConfig = Omit<CanonicalAgentConfig, 'apiKey'> & {
  apiKey: {
    type: 'plain';
    value: typeof MASKED_SECRET;
  };
};

export function maskConfig(config: CanonicalAgentConfig): MaskedAgentConfig {
  return {
    ...config,
    apiKey: {
      type: 'plain',
      value: maskSecret(config.apiKey.value),
    },
  };
}

export function maskConfigForOutput(config: CanonicalAgentConfig): string {
  return JSON.stringify(maskConfig(config), null, 2);
}
