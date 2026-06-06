import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { atomicWriteFile } from '../../src/core';

const FIXED_DATE = new Date('2026-01-02T03:04:05.006Z');

test('atomic writer writes via backup and rename', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-atomic-'));
  const filePath = join(directory, 'config.json');

  try {
    await writeFile(filePath, '{"provider":"old"}\n');
    const result = await atomicWriteFile(filePath, '{"provider":"new"}\n', {
      now: () => FIXED_DATE,
    });

    assert.equal(await readFile(filePath, 'utf8'), '{"provider":"new"}\n');
    assert.equal(result.backup?.backupPath, join(directory, 'config.json.20260102T030405006Z.bak'));
    assert.equal(await readFile(result.backup?.backupPath ?? '', 'utf8'), '{"provider":"old"}\n');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('atomic-write-failure creates backup, preserves original, and removes temp file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-atomic-'));
  const filePath = join(directory, 'config.json');

  try {
    await writeFile(filePath, '{"provider":"old"}\n');

    await assert.rejects(
      () =>
        atomicWriteFile(filePath, '{"provider":"new"}\n', {
          now: () => FIXED_DATE,
          beforeRename: () => {
            throw new Error('simulated rename failure');
          },
        }),
      /simulated rename failure/,
    );

    assert.equal(await readFile(filePath, 'utf8'), '{"provider":"old"}\n');
    assert.equal(
      await readFile(join(directory, 'config.json.20260102T030405006Z.bak'), 'utf8'),
      '{"provider":"old"}\n',
    );
    const tempFiles = (await readdir(directory)).filter((entry) => entry.endsWith('.tmp'));
    assert.deepEqual(tempFiles, []);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('atomic writer can create files containing API keys with mode 0600', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-atomic-'));
  const filePath = join(directory, 'secret.json');

  try {
    await atomicWriteFile(filePath, '{"apiKey":"redacted"}\n', {
      createBackup: false,
      mode: 0o600,
    });

    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
