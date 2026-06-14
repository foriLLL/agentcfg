import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { formatRemoteBindWarning, isLoopbackHost } from '../../src/commands/web';

const CLI_PATH = resolve(process.cwd(), 'dist/cli.js');

test('agentcfg web starts a local server with state and no-open options', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-web-'));
  const statePath = join(directory, 'state.json');

  try {
    const result = await runWebCli(['web', '--port', '0', '--host', '127.0.0.1', '--state', statePath, '--no-open']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('agentcfg web listening at http://127.0.0.1:'));
    assert.equal(result.statePath, statePath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('agentcfg web uses loopback by default without a remote bind warning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-web-default-'));
  const statePath = join(directory, 'state.json');

  try {
    const result = await runWebCli(['web', '--port', '0', '--state', statePath, '--no-open']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.stdout.includes('agentcfg web listening at http://127.0.0.1:'));
    assert.equal(result.statePath, statePath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('agentcfg web warns when explicitly binding to all IPv4 interfaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-web-ipv4-any-'));
  const statePath = join(directory, 'state.json');

  try {
    const result = await runWebCli(['web', '--port', '0', '--host', '0.0.0.0', '--state', statePath, '--no-open']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, `${formatRemoteBindWarning('0.0.0.0')}\n`);
    assert.ok(result.stdout.includes('agentcfg web listening at http://127.0.0.1:'));
    assert.equal(result.statePath, statePath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('agentcfg web warns when explicitly binding to all IPv6 interfaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-cli-web-ipv6-any-'));
  const statePath = join(directory, 'state.json');

  try {
    const result = await runWebCli(['web', '--port', '0', '--host', '::', '--state', statePath, '--no-open']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, `${formatRemoteBindWarning('::')}\n`);
    assert.ok(result.stdout.includes('agentcfg web listening at http://[::]:'));
    assert.equal(result.statePath, statePath);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('web host warning helpers only treat loopback hosts as safe', () => {
  assert.equal(isLoopbackHost(undefined), true);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('[::1]'), true);
  assert.equal(isLoopbackHost('0.0.0.0'), false);
  assert.equal(isLoopbackHost('::'), false);
  assert.equal(isLoopbackHost('192.168.1.10'), false);
  assert.equal(formatRemoteBindWarning('192.168.1.10'), '警告：当前 Web API 绑定到非本机回环地址 192.168.1.10，局域网设备可能访问并读写本机 Agent 配置。仅在可信网络中使用。');
});

test('agentcfg web rejects invalid port values', async () => {
  const result = await runCli(['web', '--port', '70000', '--no-open']);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes('--port must be an integer from 0 to 65535'), true);
});

type WebCliResult = CliResult & {
  statePath: string;
};

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

async function runWebCli(args: string[]): Promise<WebCliResult> {
  return new Promise<WebCliResult>((resolvePromise, rejectPromise) => {
    const childProcess = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, CI: 'true', PATH: `/opt/homebrew/bin:${process.env.PATH ?? ''}` },
    });
    let stdout = '';
    let stderr = '';
    let resolving = false;
    const timeout = setTimeout(() => {
      childProcess.kill('SIGTERM');
      rejectPromise(new Error(`CLI timed out: agentcfg ${args.join(' ')}`));
    }, 5000);

    childProcess.stdout.setEncoding('utf8');
    childProcess.stderr.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const match = stdout.match(/agentcfg web listening at (http:\/\/(?:127\.0\.0\.1|\[::\]):\d+)/);
      if (match !== null && !resolving) {
        resolving = true;
        void fetch(`${fetchableServerUrl(match[1])}/api/state`)
          .then((response) => response.json() as Promise<{ ok: true; data: { state: { statePath: string } } }>)
          .then((body) => {
            childProcess.kill('SIGTERM');
            childProcess.once('close', (status) => {
              clearTimeout(timeout);
              resolvePromise({ status, stdout, stderr, statePath: body.data.state.statePath });
            });
          }, rejectPromise);
      }
    });
    childProcess.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
  });
}

function fetchableServerUrl(url: string): string {
  return url.replace('http://[::]:', 'http://[::1]:');
}

async function runCli(args: string[]): Promise<CliResult> {
  return new Promise<CliResult>((resolvePromise, rejectPromise) => {
    const childProcess = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, CI: 'true', PATH: `/opt/homebrew/bin:${process.env.PATH ?? ''}` },
    });
    let stdout = '';
    let stderr = '';
    let resolving = false;
    const timeout = setTimeout(() => {
      childProcess.kill('SIGTERM');
      rejectPromise(new Error(`CLI timed out: agentcfg ${args.join(' ')}`));
    }, 5000);

    childProcess.stdout.setEncoding('utf8');
    childProcess.stderr.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    childProcess.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    childProcess.on('close', (status) => {
      clearTimeout(timeout);
      resolvePromise({ status, stdout, stderr });
    });
  });
}
