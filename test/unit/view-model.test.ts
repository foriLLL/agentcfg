import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import test from 'node:test';
import {
  agentSupportsManagedFieldDiff,
  buildRemoteYamlPreview,
  remoteAccessWarningForHostname,
  statusLabel,
  statusTone,
  syncActionCopyForAgent,
} from '../../web/src/view-model';
import type { EditableAgentConfig, RuntimeStateSummary } from '../../web/src/api';

test('buildRemoteYamlPreview serializes the complete nested remote config', () => {
  const config: EditableAgentConfig = {
    schemaVersion: 1,
    defaults: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
    },
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: {
          type: 'plain',
          value: 'sk-visible-openai-preview',
        },
        modelDiscovery: {
          path: '/models',
        },
        models: {
          'gpt-4.1-mini': {
            variant: 'chat',
            contextWindow: 1047576,
            contextTokens: 1040000,
            maxTokens: 32768,
          },
          'gpt-4.1': {},
        },
      },
      anthropic: {
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: {
          type: 'plain',
          value: 'sk-visible-anthropic-preview',
        },
        models: {
          'claude-3-5-sonnet-latest': {
            contextWindow: 200000,
            contextTokens: 180000,
            maxTokens: 8192,
          },
          'claude-3-haiku': {},
        },
      },
    },
    ohMyOpenAgent: {
      agents: {
        oracle: {
          model: 'openai/gpt-4.1-mini',
          variant: 'high',
        },
      },
      categories: {
        'visual-engineering': {
          model: 'anthropic/claude-3-5-sonnet-latest',
        },
      },
    },
  };

  const preview = buildRemoteYamlPreview(config);
  const parsed = parseYaml(preview);

  assert.deepEqual(parsed, config);
  assert.match(preview, /schemaVersion: 1/);
  assert.match(preview, /defaults:/);
  assert.match(preview, /providers:/);
  assert.match(preview, /"openai":/);
  assert.match(preview, /"anthropic":/);
  assert.match(preview, /modelDiscovery:/);
  assert.match(preview, /path: "\/models"/);
  assert.match(preview, /sk-visible-openai-preview/);
  assert.match(preview, /sk-visible-anthropic-preview/);
  assert.match(preview, /variant: "chat"/);
  assert.match(preview, /contextWindow: 1047576/);
  assert.match(preview, /contextTokens: 1040000/);
  assert.match(preview, /maxTokens: 32768/);
  assert.match(preview, /"gpt-4\.1": \{\}/);
  assert.match(preview, /"claude-3-haiku": \{\}/);
  assert.match(preview, /ohMyOpenAgent:/);
  assert.match(preview, /agents:/);
  assert.match(preview, /"oracle":/);
  assert.match(preview, /model: "openai\/gpt-4\.1-mini"/);
  assert.match(preview, /variant: "high"/);
  assert.match(preview, /categories:/);
  assert.match(preview, /"visual-engineering":/);
  assert.match(preview, /model: "anthropic\/claude-3-5-sonnet-latest"/);
});

test('buildRemoteYamlPreview omits empty OhMyOpenAgent mappings', () => {
  const config: EditableAgentConfig = {
    schemaVersion: 1,
    defaults: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
    },
    providers: {
      openai: {
        baseURL: 'https://api.openai.com/v1',
        apiKey: {
          type: 'plain',
          value: 'sk-visible-openai-preview',
        },
        models: {
          'gpt-4.1-mini': {},
        },
      },
    },
    ohMyOpenAgent: {
      agents: {},
      categories: {},
    },
  };

  const preview = buildRemoteYamlPreview(config);
  const parsed = parseYaml(preview);

  assert.equal(parsed.ohMyOpenAgent, undefined);
  assert.doesNotMatch(preview, /ohMyOpenAgent/);
});

test('status copy treats stored remote baseline metadata as cache-ready state', () => {
  const state: RuntimeStateSummary = {
    statePath: '/tmp/agentcfg-state.json',
    schemaVersion: 1,
    gist: {
      present: true,
      id: 'gist-id',
    },
    cache: {
      present: true,
      updatedAt: '2026-06-14T00:00:00.000Z',
    },
    conflict: {
      present: true,
      baseRevision: 'remote-revision',
      baseETag: 'remote-etag',
    },
  };

  assert.equal(statusTone(state), 'ready');
  assert.equal(statusLabel(state), '缓存已就绪');
  assert.notEqual(statusLabel(state), '需要检查冲突');
});

test('remote access warning helper only warns for non-loopback browser hostnames', () => {
  assert.equal(remoteAccessWarningForHostname(undefined), null);
  assert.equal(remoteAccessWarningForHostname(''), null);
  assert.equal(remoteAccessWarningForHostname('127.0.0.1'), null);
  assert.equal(remoteAccessWarningForHostname('localhost'), null);
  assert.equal(remoteAccessWarningForHostname('::1'), null);
  assert.equal(remoteAccessWarningForHostname('[::1]'), null);
  assert.equal(remoteAccessWarningForHostname('0.0.0.0'), '当前浏览器正在通过非本机回环地址 0.0.0.0 访问 agentcfg Web API，局域网设备可能访问并读写本机 Agent 配置。仅在可信网络中使用。');
  assert.equal(remoteAccessWarningForHostname('::'), '当前浏览器正在通过非本机回环地址 :: 访问 agentcfg Web API，局域网设备可能访问并读写本机 Agent 配置。仅在可信网络中使用。');
  assert.equal(remoteAccessWarningForHostname('192.168.1.10'), '当前浏览器正在通过非本机回环地址 192.168.1.10 访问 agentcfg Web API，局域网设备可能访问并读写本机 Agent 配置。仅在可信网络中使用。');
});

test('OhMyOpenAgent uses dry-run instead of field-level diff in the web flow', () => {
  assert.equal(agentSupportsManagedFieldDiff('codex'), true);
  assert.equal(agentSupportsManagedFieldDiff('opencode'), true);
  assert.equal(agentSupportsManagedFieldDiff('openclaw'), true);
  assert.equal(agentSupportsManagedFieldDiff('claude'), true);
  assert.equal(agentSupportsManagedFieldDiff('ohmyopenagent'), false);
  assert.equal(syncActionCopyForAgent('ohmyopenagent'), '拉取、dry-run 与应用都会使用当前选择的本地配置目标和路径覆盖。');
  assert.equal(syncActionCopyForAgent('opencode'), '拉取、diff、dry-run 与应用都会使用当前选择的本地配置目标和路径覆盖。');
});

test('App wires the remote access warning helper into a visible banner', async () => {
  const appSource = await readFile(join(process.cwd(), 'web', 'src', 'App.tsx'), 'utf8');

  assert.match(appSource, /remoteAccessWarningForHostname\(typeof window === 'undefined' \? undefined : window\.location\.hostname\)/);
  assert.match(appSource, /className="notice-stack"/);
  assert.match(appSource, /<strong>远程访问警告<\/strong>/);
  assert.match(appSource, /<span>\{remoteAccessWarning\}<\/span>/);
});
