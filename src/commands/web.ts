import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { stdout as defaultOutput } from 'node:process';
import type { Writable } from 'node:stream';
import { startWebServer } from '../server';

export type WebCommandOptions = {
  port?: number;
  host?: string;
  statePath?: string;
  open?: boolean;
  env?: NodeJS.ProcessEnv;
  output?: Writable & { isTTY?: boolean };
};

export function buildWebHelpText(): string {
  return [
    'Usage: agentcfg web [options]',
    '',
    'Start the local agentcfg web server.',
    '',
    'Options:',
    '  --host <host>   Host to bind (default: 127.0.0.1)',
    '  --port <port>   Port to bind (default: 8787, use 0 for ephemeral)',
    '  --state <path>  State file path used by API requests',
    '  --no-open       Do not open a browser',
    '  -h, --help      Show help',
  ].join('\n');
}

export async function runWebCommand(options: WebCommandOptions = {}): Promise<void> {
  const output = options.output ?? defaultOutput;
  const env = options.env ?? process.env;
  const server = await startWebServer({
    host: options.host,
    port: options.port,
    statePath: options.statePath,
    env,
  });

  output.write(`agentcfg web listening at ${server.url}\n`);
  if (shouldAutoOpen({ open: options.open, env, output })) {
    openBrowser(server.url);
  }

  await waitForShutdown(server.close);
}

export function shouldAutoOpen(options: {
  open?: boolean;
  env?: NodeJS.ProcessEnv;
  output?: Writable & { isTTY?: boolean };
}): boolean {
  const env = options.env ?? process.env;
  if (options.open === false) return false;
  if (env.CI === 'true' || env.CI === '1') return false;
  if (env.GITHUB_ACTIONS === 'true') return false;
  if (env.AGENTCFG_NO_OPEN === 'true' || env.AGENTCFG_NO_OPEN === '1') return false;
  if (env.SSH_CONNECTION !== undefined || env.SSH_TTY !== undefined) return false;
  if (env.CODESPACES === 'true' || env.REMOTE_CONTAINERS === 'true') return false;
  if (env.TERM === 'dumb') return false;
  if (options.output?.isTTY !== true) return false;
  return true;
}

function openBrowser(url: string): void {
  const currentPlatform = platform();
  const command = currentPlatform === 'darwin' ? 'open' : currentPlatform === 'win32' ? 'cmd' : 'xdg-open';
  const args = currentPlatform === 'win32' ? ['/c', 'start', '', url] : [url];

  try {
    const childProcess = spawn(command, args, { detached: true, stdio: 'ignore' });
    childProcess.on('error', () => undefined);
    childProcess.unref();
  } catch {
    return;
  }
}

function waitForShutdown(close: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      process.off('SIGINT', shutdown);
      process.off('SIGTERM', shutdown);
      close().then(resolvePromise, rejectPromise);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
