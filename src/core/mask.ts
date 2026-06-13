import type { CanonicalAgentConfig, ProviderConfig } from './schema';

export const MASKED_SECRET = '***MASKED***';

export function maskSecret(_secret: string): typeof MASKED_SECRET {
  return MASKED_SECRET;
}

export type MaskedProviderConfig = Omit<ProviderConfig, 'apiKey'> & {
  apiKey: {
    type: 'plain';
    value: typeof MASKED_SECRET;
  };
};

export type MaskedAgentConfig = Omit<CanonicalAgentConfig, 'providers'> & {
  providers: Record<string, MaskedProviderConfig>;
};

export function maskConfig(config: CanonicalAgentConfig): MaskedAgentConfig {
  const providers: Record<string, MaskedProviderConfig> = {};

  for (const [providerId, provider] of Object.entries(config.providers)) {
    providers[providerId] = {
      ...provider,
      apiKey: {
        type: 'plain',
        value: maskSecret(provider.apiKey.value),
      },
    };
  }

  return {
    ...config,
    providers,
  };
}

export function maskConfigForOutput(config: CanonicalAgentConfig): string {
  return JSON.stringify(maskConfig(config), null, 2);
}
