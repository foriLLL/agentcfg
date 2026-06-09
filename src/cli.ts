import { CLI_COMMANDS } from './core';
import { isAdapterName, type AdapterName } from './adapters';
import { runApplyCommand } from './commands/apply';
import { runDiffCommand } from './commands/diff';
import { runInitCommand } from './commands/init';
import { runPullCommand } from './commands/pull';
import { buildWebHelpText, runWebCommand } from './commands/web';

const VERSION = '0.0.0';

export function buildHelpText(): string {
  return [
    'Usage: agentcfg [options] <command>',
    '',
    'Commands:',
    ...CLI_COMMANDS.map((command) => `  ${command}`),
    '',
    'Options:',
    '  -h, --help     Show help',
    '  -v, --version  Show version',
  ].join('\n');
}

export function buildVersionText(): string {
  return `agentcfg v${VERSION}`;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(buildVersionText());
    return 0;
  }

  if (argv.length === 0 || ((argv[0] !== 'web' || argv.length === 1) && (argv.includes('--help') || argv.includes('-h')))) {
    console.log(buildHelpText());
    return 0;
  }

  const [command, ...commandArgs] = argv;

  if (command === 'web' && (commandArgs.includes('--help') || commandArgs.includes('-h'))) {
    console.log(buildWebHelpText());
    return 0;
  }

  try {
    if (command === 'init') {
      console.log(await runInitCommand(parseInitArgs(commandArgs)));
      return 0;
    }

    if (command === 'pull') {
      console.log(
        await runPullCommand({
          statePath: parsePullArgs(commandArgs).statePath,
          gistOptions: {
            apiBaseUrl: process.env.AGENTCFG_GIST_API_BASE_URL,
            env: process.env,
          },
        }),
      );
      return 0;
    }

    if (command === 'diff') {
      console.log(await runDiffCommand(parseDiffArgs(commandArgs)));
      return 0;
    }

    if (command === 'apply') {
      console.log(await runApplyCommand(parseApplyArgs(commandArgs)));
      return 0;
    }

    if (command === 'web') {
      await runWebCommand(parseWebArgs(commandArgs));
      return 0;
    }

    console.log(buildHelpText());
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (require.main === module) {
  void main().then((exitCode) => {
    process.exit(exitCode);
  });
}

type ParsedInitArgs = {
  gistId: string;
  statePath?: string;
};

type ParsedPullArgs = {
  statePath?: string;
};

type ParsedDiffArgs = {
  agent?: AdapterName;
  allAgents?: boolean;
  configPath?: string;
  statePath?: string;
  fixturesRoot?: string;
};

type ParsedApplyArgs = ParsedDiffArgs & {
  dryRun?: boolean;
  yes?: boolean;
};

type ParsedWebArgs = {
  port?: number;
  host?: string;
  open?: boolean;
  statePath?: string;
};

function parseInitArgs(args: string[]): ParsedInitArgs {
  let gistId: string | undefined;
  let statePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--gist') {
      gistId = readOptionValue(args, index, '--gist');
      index += 1;
      continue;
    }
    if (arg === '--state') {
      statePath = readOptionValue(args, index, '--state');
      index += 1;
      continue;
    }
    throw new Error(`Unknown init option: ${arg}`);
  }

  if (gistId === undefined) {
    throw new Error('Usage: agentcfg init --gist <gist-id> [--state <path>]');
  }

  return { gistId, statePath };
}

function parsePullArgs(args: string[]): ParsedPullArgs {
  let statePath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--state') {
      statePath = readOptionValue(args, index, '--state');
      index += 1;
      continue;
    }
    throw new Error(`Unknown pull option: ${arg}`);
  }

  return { statePath };
}

function parseDiffArgs(args: string[]): ParsedDiffArgs {
  const parsed: ParsedDiffArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--agent') {
      const agent = readOptionValue(args, index, '--agent');
      if (!isAdapterName(agent)) {
        throw new Error(`Unsupported agent '${agent}'. Expected codex, opencode, or openclaw`);
      }
      parsed.agent = agent;
      index += 1;
      continue;
    }
    if (arg === '--all-agents') {
      parsed.allAgents = true;
      continue;
    }
    if (arg === '--config-path') {
      parsed.configPath = readOptionValue(args, index, '--config-path');
      index += 1;
      continue;
    }
    if (arg === '--state') {
      parsed.statePath = readOptionValue(args, index, '--state');
      index += 1;
      continue;
    }
    if (arg === '--fixtures-root') {
      parsed.fixturesRoot = readOptionValue(args, index, '--fixtures-root');
      index += 1;
      continue;
    }
    throw new Error(`Unknown diff option: ${arg}`);
  }

  return parsed;
}

function parseApplyArgs(args: string[]): ParsedApplyArgs {
  const parsed: ParsedApplyArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--agent') {
      const agent = readOptionValue(args, index, '--agent');
      if (!isAdapterName(agent)) {
        throw new Error(`Unsupported agent '${agent}'. Expected codex, opencode, or openclaw`);
      }
      parsed.agent = agent;
      index += 1;
      continue;
    }
    if (arg === '--all-agents') {
      parsed.allAgents = true;
      continue;
    }
    if (arg === '--config-path') {
      parsed.configPath = readOptionValue(args, index, '--config-path');
      index += 1;
      continue;
    }
    if (arg === '--state') {
      parsed.statePath = readOptionValue(args, index, '--state');
      index += 1;
      continue;
    }
    if (arg === '--fixtures-root') {
      parsed.fixturesRoot = readOptionValue(args, index, '--fixtures-root');
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    if (arg === '--yes') {
      parsed.yes = true;
      continue;
    }
    throw new Error(`Unknown apply option: ${arg}`);
  }

  return parsed;
}

function parseWebArgs(args: string[]): ParsedWebArgs {
  const parsed: ParsedWebArgs = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--port') {
      parsed.port = parsePort(readOptionValue(args, index, '--port'));
      index += 1;
      continue;
    }
    if (arg === '--host') {
      const host = readOptionValue(args, index, '--host').trim();
      if (host === '') {
        throw new Error('--host requires a non-empty value');
      }
      parsed.host = host;
      index += 1;
      continue;
    }
    if (arg === '--state') {
      parsed.statePath = readOptionValue(args, index, '--state');
      index += 1;
      continue;
    }
    if (arg === '--no-open') {
      parsed.open = false;
      continue;
    }
    throw new Error(`Unknown web option: ${arg}`);
  }

  return parsed;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('--port must be an integer from 0 to 65535');
  }
  return port;
}

function readOptionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}
