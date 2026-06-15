import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildLaunchdPlist,
  buildSystemdService,
  buildSystemdTimer,
  buildWindowsCreateArgs,
  getSyncServiceStatus,
  installSyncService,
  SYNC_SERVICE_LABEL,
} from '../../src/core/scheduler';

const COMMAND = {
  nodePath: '/usr/local/bin/node',
  cliPath: '/opt/agentcfg/dist/cli.js',
} as const;

test('scheduler renders platform service artifacts with sync once command', () => {
  const plist = buildLaunchdPlist(COMMAND, '/tmp/state.json', 900);
  const service = buildSystemdService(COMMAND, '/tmp/state.json');
  const timer = buildSystemdTimer(900);
  const windowsArgs = buildWindowsCreateArgs(COMMAND, 'C:\\Users\\me\\state.json', 15);

  assert.match(plist, new RegExp(`<string>${SYNC_SERVICE_LABEL}</string>`));
  assert.match(plist, /<integer>900<\/integer>/);
  assert.match(plist, /<string>sync<\/string>/);
  assert.match(service, /ExecStart="\/usr\/local\/bin\/node" "\/opt\/agentcfg\/dist\/cli\.js" "sync" "once" "--state" "\/tmp\/state\.json"/);
  assert.match(timer, /OnUnitActiveSec=900/);
  assert.deepEqual(windowsArgs.slice(0, 8), ['/Create', '/SC', 'MINUTE', '/MO', '15', '/TN', 'agentcfg-sync', '/TR']);
  assert.match(windowsArgs[8] ?? '', /"\/usr\/local\/bin\/node"/);
});

test('scheduler installs and reports macOS launchd file with fake command runner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-scheduler-'));
  const commands: string[] = [];

  try {
    const status = await installSyncService({
      platform: 'darwin',
      homeDir: directory,
      statePath: join(directory, 'state.json'),
      intervalMinutes: 10,
      command: COMMAND,
      commandRunner: async (command, args) => {
        commands.push([command, ...args].join(' '));
      },
    });
    const serviceStatus = await getSyncServiceStatus({ platform: 'darwin', homeDir: directory });
    const plist = await readFile(status.paths[0] ?? '', 'utf8');

    assert.equal(status.installed, true);
    assert.equal(serviceStatus.installed, true);
    assert.match(plist, /<integer>600<\/integer>/);
    assert.deepEqual(commands, [
      `launchctl unload ${status.paths[0]}`,
      `launchctl load -w ${status.paths[0]}`,
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
