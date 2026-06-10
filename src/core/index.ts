export const CLI_COMMANDS = ['init', 'pull', 'diff', 'apply', 'web'] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

export const CORE_PACKAGE_NAME = 'agentcfg';

export * from './atomic-write';
export * from './backup';
export * from './diff';
export * from './mask';
export * from './gist';
export * from './native-io';
export * from './node-errors';
export * from './schema';
export * from './schema-docs';
export * from './secrets';
export * from './state';
