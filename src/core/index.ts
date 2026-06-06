export const CLI_COMMANDS = ['init', 'pull', 'diff', 'apply'] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

export const CORE_PACKAGE_NAME = 'agentcfg';

export * from './atomic-write';
export * from './backup';
export * from './diff';
export * from './mask';
export * from './gist';
export * from './native-io';
export * from './schema';
export * from './state';
