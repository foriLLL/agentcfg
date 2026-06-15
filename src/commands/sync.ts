import { ADAPTER_NAMES, isAdapterName } from '../adapters';
import {
  AUTO_SYNC_RULE_FILES_TARGET,
  runSyncOnce,
  type FetchGistOptions,
  type SyncOnceResult,
  type SyncTarget,
} from '../core';

export type RunSyncCommandOptions = {
  args: readonly string[];
  gistOptions?: FetchGistOptions;
};

type ParsedSyncOnceArgs = {
  statePath?: string;
  targets: SyncTarget[];
};

export async function runSyncCommand(options: RunSyncCommandOptions): Promise<string> {
  const [subcommand, ...args] = options.args;
  if (subcommand === 'once') {
    return formatSyncOnceResult(await runSyncOnce({ ...parseSyncOnceArgs(args), gistOptions: options.gistOptions }));
  }
  if (subcommand === 'service') {
    throw new Error('Usage: agentcfg sync service <install|uninstall|status> [options]');
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
    targets: [...new Set(targets)],
  };
}

function readOptionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
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
