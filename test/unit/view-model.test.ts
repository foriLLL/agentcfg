import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import test from 'node:test';
import {
  agentSupportsManagedFieldDiff,
  applyResultNextAction,
  applyResultsAreNoOp,
  buildRemoteYamlPreview,
  configToDraft,
  formatError,
  formatRemoteValidationError,
  localReviewActionCopyForAgent,
  remoteAccessWarningForHostname,
  statusLabel,
  statusTone,
} from '../../web/src/view-model';
import { RuntimeClientError, type AgentConfig, type ApplyAgentResult, type EditableAgentConfig, type RuntimeStateSummary } from '../../web/src/api';

test('buildRemoteYamlPreview serializes the complete nested remote config', () => {
  const config: EditableAgentConfig = {
    schemaVersion: 1,
    defaults: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
    },
    providers: {
      openai: {
        protocol: 'openai-compatible',
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
        protocol: 'anthropic-compatible',
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
  assert.match(preview, /"openai":\n    protocol: "openai-compatible"\n    baseURL: "https:\/\/api\.openai\.com\/v1"/);
  assert.match(preview, /"anthropic":\n    protocol: "anthropic-compatible"\n    baseURL: "https:\/\/api\.anthropic\.com\/v1"/);
  assert.match(preview, /protocol: "openai-compatible"/);
  assert.match(preview, /protocol: "anthropic-compatible"/);
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

test('configToDraft preserves optional provider protocols from loaded configs', () => {
  const config: AgentConfig = {
    schemaVersion: 1,
    defaults: {
      provider: 'openai',
      model: 'gpt-4.1-mini',
    },
    providers: {
      openai: {
        protocol: 'openai-compatible',
        baseURL: 'https://api.openai.com/v1',
        apiKey: {
          type: 'plain',
          value: 'sk-openai',
        },
        modelDiscovery: {
          path: '/models',
        },
        models: {
          'gpt-4.1-mini': {
            contextWindow: 1047576,
          },
        },
      },
      anthropic: {
        protocol: 'anthropic-compatible',
        baseURL: 'https://api.anthropic.com/v1',
        apiKey: {
          type: 'plain',
          value: 'sk-anthropic',
        },
        models: {
          'claude-3-5-sonnet-latest': {
            maxTokens: 8192,
          },
        },
      },
    },
  };

  const draft = configToDraft(config);

  assert.deepEqual(draft, config);
  assert.equal(draft.providers.openai.protocol, 'openai-compatible');
  assert.equal(draft.providers.anthropic.protocol, 'anthropic-compatible');
  assert.notEqual(draft.providers.openai, config.providers.openai);
  assert.notEqual(draft.providers.openai.models, config.providers.openai.models);
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

test('local review copy uses redesigned preview/apply wording for all agents', () => {
  assert.equal(agentSupportsManagedFieldDiff('codex'), true);
  assert.equal(agentSupportsManagedFieldDiff('opencode'), true);
  assert.equal(agentSupportsManagedFieldDiff('openclaw'), true);
  assert.equal(agentSupportsManagedFieldDiff('claude'), true);
  assert.equal(agentSupportsManagedFieldDiff('ohmyopenagent'), false);
  assert.equal(localReviewActionCopyForAgent('ohmyopenagent'), '预览变更与应用都会使用当前选择的本地配置目标和路径覆盖。');
  assert.equal(localReviewActionCopyForAgent('opencode'), '预览变更与应用都会使用当前选择的本地配置目标和路径覆盖。');
});

test('formatError gives GitHub Token failures a clear cause and next action', () => {
  const error = new RuntimeClientError(
    {
      code: 'gist-error',
      message: 'GitHub Gist list failed with 401 Unauthorized: Bad credentials',
    },
    502,
  );

  const copy = formatError(error);

  assert.match(copy, /原因：GitHub Gist list failed with 401 Unauthorized/);
  assert.match(copy, /下一步：确认 GitHub Token 仍有效并包含 gist 权限/);
  assert.match(copy, /Gist 已被删除/);
});

test('formatRemoteValidationError gives invalid schema failures a next action', () => {
  const copy = formatRemoteValidationError('providers.openai.apiKey.value is required');

  assert.match(copy, /原因：providers\.openai\.apiKey\.value is required/);
  assert.match(copy, /下一步：按提示修正 schema、provider、model 或必填字段后再保存/);
});

test('formatError and apply result helpers keep partial apply failures actionable per target', () => {
  const results: ApplyAgentResult[] = [
    { agent: 'opencode', status: 'applied', changes: [], notices: [], backups: ['/tmp/opencode.backup'] },
    {
      agent: 'codex',
      status: 'failed',
      changes: [],
      notices: [],
      backups: [],
      error: 'Refusing to write read-only existing file: /tmp/config.toml',
    },
  ];
  const error = new RuntimeClientError(
    {
      code: 'apply-error',
      message: 'Apply validation failed; no files were written.',
      details: { results },
    },
    400,
  );

  assert.equal(applyResultsAreNoOp(results), false);
  assert.match(formatError(error), /查看下方每个目标的失败原因/);
  assert.equal(
    applyResultNextAction(results[1] as ApplyAgentResult),
    '检查该目标配置文件和关联 Env 文件的写入权限，然后重新预览并应用。',
  );
});

test('applyResultsAreNoOp treats unchanged preview/apply results as successful no-op', () => {
  assert.equal(
    applyResultsAreNoOp([
      { agent: 'opencode', status: 'unchanged', changes: [], notices: [], backups: [] },
      { agent: 'codex', status: 'unchanged', changes: [], notices: [], backups: [] },
    ]),
    true,
  );
  assert.equal(applyResultsAreNoOp([]), false);
});

test('App wires the remote access warning helper into toast notifications', async () => {
  const appSource = await readFile(join(process.cwd(), 'web', 'src', 'App.tsx'), 'utf8');
  const toastSource = await readFile(join(process.cwd(), 'web', 'src', 'NoticeToast.tsx'), 'utf8');

  assert.match(appSource, /remoteAccessWarningForHostname\(typeof window === 'undefined' \? undefined : window\.location\.hostname\)/);
  assert.match(appSource, /<NoticeToast notice=\{notice\} remoteAccessWarning=\{remoteAccessWarning\}/);
  assert.match(appSource, /window\.setTimeout\(\(\) => setNotice\(null\), 4500\)/);
  assert.match(toastSource, /className="toast-region"/);
  assert.match(toastSource, /<strong>远程访问警告<\/strong>/);
  assert.match(toastSource, /<span>\{remoteAccessWarning\}<\/span>/);
});
