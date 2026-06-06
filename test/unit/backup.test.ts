import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildBackupPath, createTimestampedBackup, restoreBackup } from '../../src/core';

const FIXED_DATE = new Date('2026-01-02T03:04:05.006Z');

test('backup path uses injectable clock for deterministic timestamped names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-backup-'));
  const sourcePath = join(directory, 'config.toml');

  try {
    assert.equal(
      buildBackupPath(sourcePath, { now: () => FIXED_DATE }),
      join(directory, 'config.toml.20260102T030405006Z.bak'),
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('backup helper creates a timestamped copy before writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-backup-'));
  const sourcePath = join(directory, 'config.toml');

  try {
    await writeFile(sourcePath, 'provider = "openai"\n');
    const backup = await createTimestampedBackup(sourcePath, { now: () => FIXED_DATE });

    assert.equal(backup.backupPath, join(directory, 'config.toml.20260102T030405006Z.bak'));
    assert.equal(await readFile(backup.backupPath, 'utf8'), 'provider = "openai"\n');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('backup restore helper copies backup content to target', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-backup-'));
  const backupPath = join(directory, 'config.json.20260102T030405006Z.bak');
  const targetPath = join(directory, 'config.json');

  try {
    await writeFile(backupPath, '{"provider":"openai"}\n');
    await writeFile(targetPath, '{"provider":"other"}\n');
    await restoreBackup(backupPath, targetPath);

    assert.equal(await readFile(targetPath, 'utf8'), '{"provider":"openai"}\n');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
