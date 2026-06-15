import { execFile } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import { homedir, platform as currentPlatform } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { atomicWriteFile } from './atomic-write';
import { isNodeErrorWithCode } from './node-errors';
import { resolveStatePath } from './state';

export const SYNC_SERVICE_NAME = 'agentcfg-sync';
export const SYNC_SERVICE_LABEL = 'dev.agentcfg.sync';

export type SyncServicePlatform = 'darwin' | 'linux' | 'win32';

export type SyncServiceCommand = {
  nodePath: string;
  cliPath: string;
};

export type SyncServiceOptions = {
  statePath?: string;
  intervalMinutes: number;
  homeDir?: string;
  platform?: SyncServicePlatform;
  command?: SyncServiceCommand;
  commandRunner?: SyncServiceCommandRunner;
};

export type SyncServiceStatus = {
  platform: SyncServicePlatform;
  installed: boolean;
  paths: string[];
  message: string;
};

export type SyncServiceCommandRunner = (command: string, args: readonly string[]) => Promise<void>;

const execFileAsync = promisify(execFile);

export async function installSyncService(options: SyncServiceOptions): Promise<SyncServiceStatus> {
  const platform = resolvePlatform(options.platform);
  const paths = servicePaths(platform, options.homeDir ?? homedir());
  const command = options.command ?? defaultServiceCommand();
  const statePath = resolveStatePath(options.statePath);
  const intervalSeconds = intervalMinutesToSeconds(options.intervalMinutes);
  const runner = options.commandRunner ?? defaultCommandRunner;

  if (platform === 'darwin') {
    await atomicWriteFile(paths[0], buildLaunchdPlist(command, statePath, intervalSeconds), { createBackup: false, mode: 0o644 });
    await runner('launchctl', ['unload', paths[0]]).catch(() => undefined);
    await runner('launchctl', ['load', '-w', paths[0]]);
  } else if (platform === 'linux') {
    await atomicWriteFile(paths[0], buildSystemdService(command, statePath), { createBackup: false, mode: 0o644 });
    await atomicWriteFile(paths[1], buildSystemdTimer(intervalSeconds), { createBackup: false, mode: 0o644 });
    await runner('systemctl', ['--user', 'daemon-reload']);
    await runner('systemctl', ['--user', 'enable', '--now', `${SYNC_SERVICE_NAME}.timer`]);
  } else {
    await runner('schtasks', buildWindowsCreateArgs(command, statePath, options.intervalMinutes));
  }

  return { platform, installed: true, paths, message: 'Sync service installed.' };
}

export async function uninstallSyncService(options: Omit<SyncServiceOptions, 'intervalMinutes'>): Promise<SyncServiceStatus> {
  const platform = resolvePlatform(options.platform);
  const paths = servicePaths(platform, options.homeDir ?? homedir());
  const runner = options.commandRunner ?? defaultCommandRunner;

  if (platform === 'darwin') {
    await runner('launchctl', ['unload', paths[0]]).catch(() => undefined);
    await rm(paths[0], { force: true });
  } else if (platform === 'linux') {
    await runner('systemctl', ['--user', 'disable', '--now', `${SYNC_SERVICE_NAME}.timer`]).catch(() => undefined);
    await rm(paths[0], { force: true });
    await rm(paths[1], { force: true });
    await runner('systemctl', ['--user', 'daemon-reload']).catch(() => undefined);
  } else {
    await runner('schtasks', ['/Delete', '/TN', SYNC_SERVICE_NAME, '/F']).catch(() => undefined);
  }

  return { platform, installed: false, paths, message: 'Sync service uninstalled.' };
}

export async function getSyncServiceStatus(
  options: Pick<SyncServiceOptions, 'homeDir' | 'platform' | 'commandRunner'> = {},
): Promise<SyncServiceStatus> {
  const platform = resolvePlatform(options.platform);
  const paths = servicePaths(platform, options.homeDir ?? homedir());

  if (platform === 'win32') {
    const runner = options.commandRunner ?? defaultCommandRunner;
    try {
      await runner('schtasks', ['/Query', '/TN', SYNC_SERVICE_NAME]);
      return { platform, installed: true, paths, message: 'Windows scheduled task exists.' };
    } catch (error) {
      if (error instanceof Error) {
        return { platform, installed: false, paths, message: 'Windows scheduled task is not installed.' };
      }
      throw error;
    }
  }

  const installed = await Promise.all(paths.map(fileExists));
  return {
    platform,
    installed: installed.every(Boolean),
    paths,
    message: installed.every(Boolean) ? 'Sync service files exist.' : 'Sync service is not installed.',
  };
}

export function buildLaunchdPlist(command: SyncServiceCommand, statePath: string, intervalSeconds: number): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${xmlEscape(SYNC_SERVICE_LABEL)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...syncCommandArgs(command, statePath).map((arg) => `    <string>${xmlEscape(arg)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>StartInterval</key>',
    `  <integer>${intervalSeconds}</integer>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function buildSystemdService(command: SyncServiceCommand, statePath: string): string {
  return [
    '[Unit]',
    'Description=agentcfg automatic sync',
    '',
    '[Service]',
    'Type=oneshot',
    `ExecStart=${syncCommandArgs(command, statePath).map(systemdQuote).join(' ')}`,
    '',
  ].join('\n');
}

export function buildSystemdTimer(intervalSeconds: number): string {
  return [
    '[Unit]',
    'Description=Run agentcfg automatic sync',
    '',
    '[Timer]',
    'OnBootSec=60',
    `OnUnitActiveSec=${intervalSeconds}`,
    'Unit=agentcfg-sync.service',
    '',
    '[Install]',
    'WantedBy=timers.target',
    '',
  ].join('\n');
}

export function buildWindowsCreateArgs(command: SyncServiceCommand, statePath: string, intervalMinutes: number): string[] {
  return [
    '/Create',
    '/SC',
    'MINUTE',
    '/MO',
    String(optionsInterval(intervalMinutes)),
    '/TN',
    SYNC_SERVICE_NAME,
    '/TR',
    syncCommandArgs(command, statePath).map(windowsQuote).join(' '),
    '/F',
  ];
}

function servicePaths(platform: SyncServicePlatform, homeDir: string): string[] {
  if (platform === 'darwin') {
    return [join(homeDir, 'Library', 'LaunchAgents', `${SYNC_SERVICE_LABEL}.plist`)];
  }
  if (platform === 'linux') {
    const directory = join(homeDir, '.config', 'systemd', 'user');
    return [join(directory, `${SYNC_SERVICE_NAME}.service`), join(directory, `${SYNC_SERVICE_NAME}.timer`)];
  }
  return [];
}

function syncCommandArgs(command: SyncServiceCommand, statePath: string): string[] {
  return [command.nodePath, command.cliPath, 'sync', 'once', '--state', statePath];
}

function defaultServiceCommand(): SyncServiceCommand {
  return {
    nodePath: process.execPath,
    cliPath: resolve(process.argv[1] ?? 'dist/cli.js'),
  };
}

function resolvePlatform(platform: SyncServiceOptions['platform']): SyncServicePlatform {
  const resolved = platform ?? currentPlatform();
  if (resolved === 'darwin' || resolved === 'linux' || resolved === 'win32') {
    return resolved;
  }
  throw new SchedulerError(`Unsupported sync service platform: ${resolved}`);
}

function intervalMinutesToSeconds(intervalMinutes: number): number {
  return optionsInterval(intervalMinutes) * 60;
}

function optionsInterval(intervalMinutes: number): number {
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1) {
    throw new SchedulerError('intervalMinutes must be a positive integer.');
  }
  return intervalMinutes;
}

async function defaultCommandRunner(command: string, args: readonly string[]): Promise<void> {
  await execFileAsync(command, [...args], { encoding: 'utf8' });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function windowsQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export class SchedulerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchedulerError';
  }
}
