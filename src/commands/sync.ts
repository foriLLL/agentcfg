import { ADAPTER_NAMES, isAdapterName } from '../adapters';
import {
  AUTO_SYNC_RULE_FILES_TARGET,
  getSyncServiceStatus,
  installSyncService,
  runSyncOnce,
  uninstallSyncService,
  type FetchGistOptions,
  type SyncOnceResult,
  type SyncServiceStatus,
  type SyncTarget,
} from '../core';

export type RunSyncCommandOptions = {
  args: readonly string[];
  gistOptions?: FetchGistOptions;
};

type ParsedSyncOnceArgs = {
  statePath?: string;
  targets?: SyncTarget[];
};

type ParsedSyncServiceArgs = {
  action: 'install' | 'uninstall' | 'status';
  statePath?: string;
  intervalMinutes: number;
};

export async function runSyncCommand(options: RunSyncCommandOptions): Promise<string> {
  const [subcommand, ...args] = options.args;
  if (subcommand === 'once') {
    return formatSyncOnceResult(await runSyncOnce({ ...parseSyncOnceArgs(args), gistOptions: options.gistOptions }));
  }
  if (subcommand === 'service') {
    const parsed = parseSyncServiceArgs(args);
    if (parsed.action === 'install') {
      return formatSyncServiceStatus(await installSyncService(parsed));
    }
    if (parsed.action === 'uninstall') {
      return formatSyncServiceStatus(await uninstallSyncService(parsed));
    }
    return formatSyncServiceStatus(await getSyncServiceStatus());
  }
  throw new Error(buildSyncHelpText());
}

export function buildSyncHelpText(): string {
  return [
    'Usage: agentcfg sync <command>',
    '',
    'Commands:',
    '  once       Run one configured sync immediately',
    '  service    Manage the system background sync service',
    '',
    'sync once options:',
    `  --agent <${ADAPTER_NAMES.join('|')}>`,
    '  --all-agents',
    '  --rules',
    '  --state <path>',
    '',
    'sync service options:',
    '  install --interval-minutes <minutes> [--state <path>]',
    '  uninstall [--state <path>]',
    '  status',
  ].join('\n');
}

function parseSyncOnceArgs(args: readonly string[]): ParsedSyncOnceArgs {
  const targets: SyncTarget[] = [];
  let statePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--state') {
      statePath = readOptionValue(args, index, '--state');
      index += 1;
      continue;
    }
    if (arg === '--agent') {
      const agent = readOptionValue(args, index, '--agent');
      if (!isAdapterName(agent)) {
        throw new Error(`Unsupported agent '${agent}'. Expected ${ADAPTER_NAMES.join(', ')}`);
      }
      targets.push(agent);
      index += 1;
      continue;
    }
    if (arg === '--all-agents') {
      targets.push(...ADAPTER_NAMES);
      continue;
    }
    if (arg === '--rules') {
      targets.push(AUTO_SYNC_RULE_FILES_TARGET);
      continue;
    }
    throw new Error(`Unknown sync once option: ${arg}`);
  }

  return {
    statePath,
    ...(targets.length === 0 ? {} : { targets: [...new Set(targets)] }),
  };
}

function parseSyncServiceArgs(args: readonly string[]): ParsedSyncServiceArgs {
  const [action, ...options] = args;
  if (action !== 'install' && action !== 'uninstall' && action !== 'status') {
    throw new Error('Usage: agentcfg sync service <install|uninstall|status> [options]');
  }

  let statePath: string | undefined;
  let intervalMinutes = 60;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === '--state') {
      statePath = readOptionValue(options, index, '--state');
      index += 1;
      continue;
    }
    if (option === '--interval-minutes') {
      intervalMinutes = parseIntervalMinutes(readOptionValue(options, index, '--interval-minutes'));
      index += 1;
      continue;
    }
    throw new Error(`Unknown sync service option: ${option}`);
  }

  return { action, statePath, intervalMinutes };
}

function readOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseIntervalMinutes(value: string): number {
  const intervalMinutes = Number(value);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    throw new Error('--interval-minutes must be a positive integer');
  }
  return intervalMinutes;
}

function formatSyncOnceResult(result: SyncOnceResult): string {
  const lines = [
    `Sync ${result.status}.`,
    `Targets: ${result.targets.join(', ')}`,
    `Started: ${result.startedAt}`,
    `Completed: ${result.completedAt}`,
  ];
  if (result.message !== undefined) {
    lines.push(`Message: ${result.message}`);
  }
  for (const agent of result.agents) {
    lines.push(`Agent ${agent.agent}: ${agent.status}`);
  }
  for (const file of result.ruleFiles) {
    lines.push(`Rule file ${file.gistFileName}: ${file.status}${file.error === undefined ? '' : ` (${file.error})`}`);
  }
  return lines.join('\n');
}

function formatSyncServiceStatus(status: SyncServiceStatus): string {
  return [
    `Sync service ${status.installed ? 'installed' : 'not installed'}.`,
    `Platform: ${status.platform}`,
    `Message: ${status.message}`,
    ...status.paths.map((path) => `Path: ${path}`),
  ].join('\n');
}
