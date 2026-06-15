import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { AgentCfgWebServer } from '../../src/server';
import { buildGistBody, startFakeGistServer } from '../helpers/fake-gist';

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CACHED_SECRET = ['gui', 'cached', 'secret'].join('-');
const NATIVE_SECRET = ['gui', 'native', 'secret'].join('-');
const GITHUB_TOKEN = 'gui-github-token';
const SAVED_GITHUB_TOKEN_MASK = '************';
const VALID_AGENTCFG_YAML = [
  'schemaVersion: 1',
  'defaults:',
  '  provider: openai',
  '  model: gpt-4.1-mini',
  'providers:',
  '  openai:',
  '    baseURL: https://api.openai.com/v1',
  '    apiKey:',
  '      type: plain',
  `      value: ${CACHED_SECRET}`,
  '    modelDiscovery:',
  '      path: /models',
  '    models:',
  '      gpt-4.1-mini:',
  '        variant: chat',
  '        contextWindow: 1047576',
  '        contextTokens: 1040000',
  '        maxTokens: 32768',
  '',
].join('\n');

test('web GUI completes init pull diff dry-run preview and confirmed apply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-flow-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');
  const codexDirectory = join(directory, 'codex');
  const codexNativePath = join(codexDirectory, 'input.config.toml');
  const codexEnvDirectory = join(directory, '.agentcfg', 'env');
  const codexEnvPath = join(codexEnvDirectory, 'codex.env');
  const defaultOpenCodeDirectory = join(directory, '.config', 'opencode');
  const defaultOpenCodePath = join(defaultOpenCodeDirectory, 'opencode.json');
  const allTargetsDirectory = join(directory, 'all-targets');
  const browserProfile = join(directory, 'chrome-profile');
  const lastStatePathFile = join(directory, 'last-state-path.json');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let fakeGist: Awaited<ReturnType<typeof startFakeGistServer>> | undefined;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;
  let restartedWebServer: { close(): Promise<void>; url: string } | undefined;

  try {
    process.env.HOME = directory;
    const { startWebServer } = await import('../../src/server');
    fakeGist = await startFakeGistServer([
      { status: 200, body: [] },
      { status: 201, etag: 'W/"gui-create-etag"', body: { id: 'gui-gist-id', ...buildGistBody('', 'gui-created-revision') } },
      { status: 200, etag: 'W/"gui-load-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-load-revision') },
      { status: 200, etag: 'W/"gui-reload-load-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-reload-load-revision') },
      { status: 200, etag: 'W/"gui-port-change-load-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-port-change-load-revision') },
      { status: 200, etag: 'W/"gui-pull-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-revision') },
    ]);
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: {
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: fakeGist.apiBaseUrl,
        AGENTCFG_LAST_STATE_PATH_FILE: lastStatePathFile,
        GITHUB_TOKEN: '',
      },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    await mkdir(defaultOpenCodeDirectory, { recursive: true });
    await mkdir(codexDirectory, { recursive: true });
    await mkdir(codexEnvDirectory, { recursive: true });
    await mkdir(allTargetsDirectory, { recursive: true });
    await writeFile(defaultOpenCodePath, opencodeNativeJson(NATIVE_SECRET));
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));
    await writeFile(codexNativePath, codexNativeToml());
    await writeFile(codexEnvPath, `AGENTCFG_OPENAI_API_KEY=${CACHED_SECRET}\n`);
    await writeFile(join(allTargetsDirectory, 'input.config.toml'), codexNativeToml());
    await writeFile(join(allTargetsDirectory, 'opencode.jsonc'), opencodeNativeJson(NATIVE_SECRET));
    await writeFile(join(allTargetsDirectory, 'openclaw.json5'), openclawNativeJson(NATIVE_SECRET));
    await writeFile(join(allTargetsDirectory, 'settings.json'), claudeNativeJson(NATIVE_SECRET));
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForFunction('document.body?.innerText.includes("连接状态") === true');
      await cdp.waitForFunction('document.scrollingElement !== null && document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight');
      await cdp.installFetchRecorder();
      await assertFixtureRootControlHidden(cdp);
      await assertNoDesktopFrame(cdp);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 638, deviceScaleFactor: 1, mobile: false });
      await cdp.waitForFunction(`(() => {
        const appShell = document.querySelector('.app-shell');
        const header = document.querySelector('.app-header');
        const tabViewport = document.querySelector('.tab-viewport');
        const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
        if (!(appShell instanceof HTMLElement) || !(header instanceof HTMLElement) || !(tabViewport instanceof HTMLElement) || tabButtons.length === 0) {
          return false;
        }
        const appShellRect = appShell.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        const shellIsFlush = Math.abs(appShellRect.left) <= 1 && Math.abs(window.innerWidth - appShellRect.right) <= 1 && Math.abs(appShellRect.top) <= 1;
        const tabsStaySingleLine = tabButtons.every((button) => button instanceof HTMLElement && window.getComputedStyle(button).whiteSpace === 'nowrap');
        const headerUsesDesktopColumns = window.getComputedStyle(header).gridTemplateColumns.split(' ').filter(Boolean).length === 3;
        const viewportOwnsScroll = ['auto', 'scroll'].includes(window.getComputedStyle(tabViewport).overflowY);
        return shellIsFlush && tabsStaySingleLine && headerUsesDesktopColumns && headerRect.height < 120 && viewportOwnsScroll;
      })()`);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await assertDomHasNoGitHubToken(cdp, 'initial DOM');
      await assertBrowserStorageHasNoSecretsOrStatePath(cdp, statePath, 'initial browser storage');

      await cdp.setInputValue('#github-token', GITHUB_TOKEN);
      await cdp.setInputValue('#state-path', statePath);
      await cdp.waitForFunction('document.querySelector("#remember-github-token") instanceof HTMLInputElement && !document.querySelector("#remember-github-token").disabled');
      await cdp.clickSelector('#remember-github-token');
      await cdp.submitForm('.setup-form');
      await cdp.waitForText('准备创建远端配置');
      await assertDomHasNoGitHubToken(cdp, 'post-init DOM');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/remote/setup'), {
        statePath,
        githubToken: GITHUB_TOKEN,
        rememberGitHubToken: true,
      });

      await cdp.waitForText('远端配置');
      await assertButtonVisibleBeforeScroll(cdp, '#remote-panel', '加载远端配置');
      await assertButtonVisibleBeforeScroll(cdp, '#remote-panel', '保存远端配置');
      await assertNoRemoteBottomActions(cdp);
      await assertSelectorVisible(cdp, '#remote-provider');
      await assertSelectorVisible(cdp, '#remote-model');
      await assertSelectorVisible(cdp, '#remote-base-url');
      await assertSelectorVisible(cdp, '#remote-api-key');
      await assertSelectorVisible(cdp, '#remote-model-discovery-path');
      await assertSelectorVisible(cdp, '#remote-model-variant');
      await assertSelectorVisible(cdp, '#remote-model-context-window');
      await assertSelectorVisible(cdp, '#remote-model-context-tokens');
      await assertSelectorVisible(cdp, '#remote-model-max-tokens');
      await assertSelectorVisible(cdp, '#remote-default-provider');
      await assertSelectorVisible(cdp, '#remote-default-model');
      await assertSelectorVisible(cdp, '#remote-ohmyopenagent-agents-oracle-model');
      await assertSelectorVisible(cdp, '#remote-ohmyopenagent-agents-oracle-variant');
      await assertSelectorVisible(cdp, '#remote-ohmyopenagent-categories-visual-engineering-model');
      await assertRemoteEditorMode(cdp);
      await switchRemoteConfigView(cdp, 'preview');
      await assertSelectorVisible(cdp, '#remote-yaml-preview');
      await assertSelectorVisible(cdp, '#remote-schema-preview');
      await assertRemotePreviewLayout(cdp);
      assert.match(await cdp.textContent('#remote-yaml-preview'), /agentcfg.yaml|schemaVersion/);
      const initialSchemaDocs = await cdp.textContent('#remote-schema-preview');
      assert.match(initialSchemaDocs, /schemaVersion/);
      assert.match(initialSchemaDocs, /defaults\.provider/);
      assert.match(initialSchemaDocs, /providers\.<provider>\.apiKey\.type/);
      assert.match(initialSchemaDocs, /providers\.<provider>\.apiKey\.value/);
      assert.match(initialSchemaDocs, /providers\.<provider>\.modelDiscovery\.path/);
      assert.match(initialSchemaDocs, /providers\.<provider>\.models\.<model>\.contextWindow/);
      assert.match(initialSchemaDocs, /ohMyOpenAgent\.agents\.<agent>\.model/);
      assert.match(initialSchemaDocs, /ohMyOpenAgent\.categories\.<category>\.model/);
      assert.match(initialSchemaDocs, /plain/);
      assert.match(initialSchemaDocs, /plain 表示提供商 API Key 以明文存储在 agentcfg\.yaml 中，并按原值写入目标 Agent 配置/);
      assert.equal(initialSchemaDocs.includes('当前 plain'), false, 'schema docs repeated the current apiKey.type value');
      await assertSchemaReferenceTree(cdp);
      await switchRemoteConfigView(cdp, 'editor');
      await cdp.setInputValue('#remote-provider', 'openai');
      await cdp.setInputValue('#remote-model', 'gpt-4.1-mini');
      await cdp.setInputValue('#remote-base-url', 'https://api.openai.com/v1');
      await cdp.setInputValue('#remote-api-key', CACHED_SECRET);
      await cdp.setInputValue('#remote-model-discovery-path', '/models');
      await cdp.setInputValue('#remote-model-variant', 'chat');
      await cdp.setInputValue('#remote-model-context-window', '1047576');
      await cdp.setInputValue('#remote-model-context-tokens', '1040000');
      await cdp.setInputValue('#remote-model-max-tokens', '32768');
      await cdp.setInputValue('#remote-provider', 'open/router');
      await cdp.clickButton('保存远端配置');
      await cdp.waitForText('提供商 ID 不能包含 /');
      await cdp.setInputValue('#remote-provider', 'openai');
      await cdp.clickButton('添加提供商');
      await cdp.setInputValue('#remote-provider', 'anthropic');
      await cdp.setInputValue('#remote-base-url', 'https://api.anthropic.com/v1');
      await cdp.setInputValue('#remote-api-key', 'sk-gui-visible-anthropic');
      await cdp.setInputValue('#remote-model', 'claude-3-5-sonnet-latest');
      await cdp.setInputValue('#remote-model-context-window', '200000');
      await cdp.setInputValue('#remote-model-context-tokens', '180000');
      await cdp.setInputValue('#remote-model-max-tokens', '8192');
      await cdp.clickButton('添加模型');
      await cdp.setInputValue('#remote-model', 'claude-3-haiku');
      await cdp.setInputValue('#remote-model', 'claude-3-5-sonnet-latest');
      await cdp.waitForText('模型 ID 已存在');
      await cdp.waitForFunction('document.querySelector("#remote-model") instanceof HTMLInputElement && document.querySelector("#remote-model").value === "claude-3-haiku"');
      await switchRemoteConfigView(cdp, 'preview');
      const yamlPreviewAfterDuplicateModel = await cdp.textContent('#remote-yaml-preview');
      assert.match(yamlPreviewAfterDuplicateModel, /claude-3-5-sonnet-latest/);
      assert.match(yamlPreviewAfterDuplicateModel, /"claude-3-haiku": \{\}/);
      assert.match(yamlPreviewAfterDuplicateModel, /contextWindow: 200000/);
      await switchRemoteConfigView(cdp, 'editor');
      await cdp.setInputValue('#remote-provider', 'openai');
      await cdp.waitForText('提供商 ID 已存在');
      await cdp.waitForFunction('document.querySelector("#remote-provider") instanceof HTMLInputElement && document.querySelector("#remote-provider").value === "anthropic"');
      await switchRemoteConfigView(cdp, 'preview');
      const yamlPreviewAfterDuplicateProvider = await cdp.textContent('#remote-yaml-preview');
      assert.match(yamlPreviewAfterDuplicateProvider, /openai/);
      assert.match(yamlPreviewAfterDuplicateProvider, /anthropic/);
      assert.equal(yamlPreviewAfterDuplicateProvider.includes(CACHED_SECRET), true, 'duplicate provider rename dropped the existing openai API key');
      assert.equal(yamlPreviewAfterDuplicateProvider.includes('sk-gui-visible-anthropic'), true, 'duplicate provider rename dropped the current anthropic API key');
      await switchRemoteConfigView(cdp, 'editor');
      await cdp.selectValue('#remote-default-provider', 'openai');
      await cdp.selectValue('#remote-default-model', 'gpt-4.1-mini');
      assert.equal(await cdp.selectValue('#remote-ohmyopenagent-agents-oracle-model', 'openai/gpt-4.1-mini'), true, 'Oracle model route select was not editable');
      assert.equal(await cdp.selectValue('#remote-ohmyopenagent-agents-oracle-variant', 'high'), true, 'Oracle variant select was not editable');
      assert.equal(await cdp.selectValue('#remote-ohmyopenagent-categories-visual-engineering-model', 'anthropic/claude-3-5-sonnet-latest'), true, 'visual-engineering category model route select was not editable');
      await switchRemoteConfigView(cdp, 'preview');
      const yamlPreviewWithSecretInput = await cdp.textContent('#remote-yaml-preview');
      assert.match(yamlPreviewWithSecretInput, /defaults:/);
      assert.match(yamlPreviewWithSecretInput, /providers:/);
      assert.match(yamlPreviewWithSecretInput, /openai/);
      assert.match(yamlPreviewWithSecretInput, /anthropic/);
      assert.match(yamlPreviewWithSecretInput, /models:/);
      assert.match(yamlPreviewWithSecretInput, /gpt-4\.1-mini/);
      assert.match(yamlPreviewWithSecretInput, /claude-3-5-sonnet-latest/);
      assert.match(yamlPreviewWithSecretInput, /"claude-3-haiku": \{\}/);
      assert.match(yamlPreviewWithSecretInput, /contextWindow: 200000/);
      assert.match(yamlPreviewWithSecretInput, /ohMyOpenAgent:/);
      assert.match(yamlPreviewWithSecretInput, /"?oracle"?:/);
      assert.match(yamlPreviewWithSecretInput, /model: "openai\/gpt-4\.1-mini"/);
      assert.match(yamlPreviewWithSecretInput, /variant: "high"/);
      assert.match(yamlPreviewWithSecretInput, /"?visual-engineering"?:/);
      assert.match(yamlPreviewWithSecretInput, /model: "anthropic\/claude-3-5-sonnet-latest"/);
      assert.equal(yamlPreviewWithSecretInput.includes(CACHED_SECRET), true, 'raw YAML preview did not show the edited API key');
      assert.equal(yamlPreviewWithSecretInput.includes('sk-gui-visible-anthropic'), true, 'raw YAML preview did not show the non-selected provider API key');
      const schemaDocsWithSecretInput = await cdp.textContent('#remote-schema-preview');
      assert.equal(schemaDocsWithSecretInput.includes(CACHED_SECRET), false, 'schema docs exposed the edited provider API key');
      assert.equal(schemaDocsWithSecretInput.includes('当前 plain'), false, 'schema docs repeated the current apiKey.type value');
      await switchRemoteConfigView(cdp, 'editor');
      await cdp.clickButton('保存远端配置');
      await cdp.waitForText('远端配置已保存');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/remote/save'), {
        statePath,
        config: {
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
                value: CACHED_SECRET,
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
              },
            },
            anthropic: {
              baseURL: 'https://api.anthropic.com/v1',
              apiKey: {
                type: 'plain',
                value: 'sk-gui-visible-anthropic',
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
        },
      });
      const remoteSaveBody = await lastRecordedJsonBody(cdp, '/api/remote/save');
      const remoteSaveConfig = remoteSaveBody.config as Record<string, unknown>;
      assert.equal(Object.prototype.hasOwnProperty.call(remoteSaveConfig, 'provider'), false, 'remote save payload reintroduced flat provider');
      assert.equal(Object.prototype.hasOwnProperty.call(remoteSaveConfig, 'model'), false, 'remote save payload reintroduced flat model');
      assert.equal(Object.prototype.hasOwnProperty.call(remoteSaveConfig, 'baseURL'), false, 'remote save payload reintroduced flat baseURL');
      assert.equal(Object.prototype.hasOwnProperty.call(remoteSaveConfig, 'apiKey'), false, 'remote save payload reintroduced flat apiKey');
      assert.equal(await cdp.inputValue('#remote-api-key'), CACHED_SECRET, 'API key input did not show the saved value after save');
      await switchRemoteConfigView(cdp, 'preview');
      assert.equal((await cdp.bodyText()).includes(CACHED_SECRET), true, 'post-save DOM did not show provider API key');
      await assertDomHasNoGitHubToken(cdp, 'post-remote-save DOM');
      await switchRemoteConfigView(cdp, 'editor');

      const secretsAfterSave = await readFile(join(directory, 'secrets.json'), 'utf8');
      assert.equal(secretsAfterSave.includes(GITHUB_TOKEN), true, 'remembered GitHub Token was not written to local secrets.json');
      await assertBrowserStorageHasNoSecretsOrStatePath(cdp, statePath, 'post-save browser storage');
      await cdp.clickButton('连接 GitHub');
      await assertSavedGitHubTokenLocked(cdp, 'post-save GitHub Token input');
      await cdp.clickButton('编辑保存的 Token');
      await assertGitHubTokenEditable(cdp, 'editing saved GitHub Token input');
      await cdp.setInputValue('#github-token', 'replacement-token-draft');
      assert.equal(await cdp.inputValue('#github-token'), 'replacement-token-draft', 'GitHub Token replacement draft was not editable');
      await cdp.clickButton('取消编辑');
      await assertSavedGitHubTokenLocked(cdp, 'cancelled GitHub Token edit input');
      await cdp.clickButton('远端配置');
      await cdp.clickButton('加载远端配置');
      await cdp.waitForText('远端配置已加载');
      assert.equal(await cdp.inputValue('#remote-api-key'), CACHED_SECRET, 'API key input did not show the loaded value after load');
      await switchRemoteConfigView(cdp, 'preview');
      assert.equal((await cdp.bodyText()).includes(CACHED_SECRET), true, 'post-load DOM did not show provider API key');
      await assertDomHasNoGitHubToken(cdp, 'post-remote-load DOM');
      await switchRemoteConfigView(cdp, 'editor');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/remote/load'), { statePath });

      await cdp.send('Page.reload', { ignoreCache: true });
      await cdp.waitForFunction(`(() => {
        const statePathInput = document.querySelector('#state-path');
        const navigation = performance.getEntriesByType('navigation').at(-1);
        return document.readyState === 'complete'
          && navigation instanceof PerformanceNavigationTiming
          && navigation.type === 'reload'
          && statePathInput instanceof HTMLInputElement
          && statePathInput.value === ${JSON.stringify(statePath)}
          && document.body?.innerText.includes('已保存 GitHub Token，输入框已锁定为固定掩码。') === true;
      })()`);
      await assertSavedGitHubTokenLocked(cdp, 'post-reload GitHub Token input');
      await assertDomHasNoGitHubToken(cdp, 'post-reload DOM');
      await assertBrowserStorageHasNoSecretsOrStatePath(cdp, statePath, 'post-reload browser storage');
      assert.equal((await firstRecordedFetchUrl(cdp, '/api/state')), '/api/state');
      await cdp.clickButton('远端配置');
      await cdp.waitForText('远端配置已自动刷新');
      assert.equal(await cdp.inputValue('#remote-api-key'), CACHED_SECRET, 'API key input did not show the auto-refreshed value after reload');
      await assertDomHasNoGitHubToken(cdp, 'post-reload-remote-auto-refresh DOM');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/remote/load'), { statePath });

      restartedWebServer = await startWebServer({
        host: '127.0.0.1',
        port: 0,
        statePath,
        assetsDir: resolve(process.cwd(), 'web', 'dist'),
        env: {
          ...process.env,
          AGENTCFG_GIST_API_BASE_URL: fakeGist.apiBaseUrl,
          AGENTCFG_LAST_STATE_PATH_FILE: lastStatePathFile,
          GITHUB_TOKEN: '',
        },
      });
      await cdp.send('Page.navigate', { url: restartedWebServer.url });
      await cdp.waitForFunction(`(() => {
        const statePathInput = document.querySelector('#state-path');
        return document.readyState === 'complete'
          && statePathInput instanceof HTMLInputElement
          && statePathInput.value === ${JSON.stringify(statePath)}
          && document.body?.innerText.includes('已保存 GitHub Token，输入框已锁定为固定掩码。') === true;
      })()`);
      await assertSavedGitHubTokenLocked(cdp, 'post-port-change GitHub Token input');
      await assertDomHasNoGitHubToken(cdp, 'post-port-change DOM');
      assert.equal(await firstRecordedFetchUrl(cdp, '/api/state'), '/api/state');
      await assertBrowserStorageHasNoSecretsOrStatePath(cdp, statePath, 'post-port-change browser storage');
      await cdp.clickButton('远端配置');
      await cdp.waitForText('远端配置已自动刷新');
      assert.equal(await cdp.inputValue('#remote-api-key'), CACHED_SECRET, 'API key input did not show the auto-refreshed value after port-change navigation');
      assert.deepEqual(await cdp.evaluate(`(() => {
        const titleArea = document.querySelector('.app-title-area');
        const headerActions = document.querySelector('.header-actions');
        const remotePanel = document.querySelector('#remote-panel');
        return {
          leftStatusPresent: titleArea?.querySelector(':scope > span') !== null,
          headerButtonCount: headerActions?.querySelectorAll('button').length ?? -1,
          headerStatusPresent: headerActions?.querySelector('.status-badge') !== null,
          remotePullPresent: Array.from(remotePanel?.querySelectorAll('.section-actions button') ?? []).some((button) => button.textContent?.includes('拉取远端') === true),
        };
      })()`), {
        leftStatusPresent: false,
        headerButtonCount: 0,
        headerStatusPresent: true,
        remotePullPresent: true,
      });
      await assertDomHasNoGitHubToken(cdp, 'post-port-change-remote-auto-refresh DOM');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/remote/load'), { statePath });

      const stateAfterSave = await readFile(statePath, 'utf8');
      assert.equal(stateAfterSave.includes(GITHUB_TOKEN), false, 'state file exposed the GitHub Token after remote save/load');
      assert.equal(JSON.parse(stateAfterSave).gist.id, 'gui-gist-id');

      await cdp.clickButton('拉取远端');
      await cdp.waitForText('已拉取远端配置');
      assert.equal(await cdp.inputValue('#remote-api-key'), CACHED_SECRET, 'API key input did not show the pulled value after pull');
      await switchRemoteConfigView(cdp, 'preview');
      await cdp.waitForText(CACHED_SECRET);
      await assertDomHasNoGitHubToken(cdp, 'post-pull DOM');
      assert.deepEqual(fakeGist.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
        { url: '/?per_page=100', method: 'GET', authorization: `Bearer ${GITHUB_TOKEN}` },
        { url: '/', method: 'POST', authorization: `Bearer ${GITHUB_TOKEN}` },
        { url: '/gui-gist-id', method: 'GET', authorization: `Bearer ${GITHUB_TOKEN}` },
        { url: '/gui-gist-id', method: 'GET', authorization: `Bearer ${GITHUB_TOKEN}` },
        { url: '/gui-gist-id', method: 'GET', authorization: `Bearer ${GITHUB_TOKEN}` },
        { url: '/gui-gist-id', method: 'GET', authorization: `Bearer ${GITHUB_TOKEN}` },
      ]);

      await cdp.clickButton('连接 GitHub');
      await cdp.clickButton('清除保存的 Token');
      await cdp.waitForText('已清除本地 Token');
      await assertGitHubTokenEditable(cdp, 'cleared GitHub Token input');
      await assertDomHasNoGitHubToken(cdp, 'post-token-clear DOM');

      const stateApi = await requestText(webServer.url, `/api/state?statePath=${encodeURIComponent(statePath)}`);
      assert.equal(stateApi.includes(CACHED_SECRET), true, 'state API response did not include provider API key');
      assertNoGitHubToken(stateApi, 'state API response');
      const stateAfterTokenClear = await readFile(statePath, 'utf8');
      assert.equal(stateAfterTokenClear.includes(GITHUB_TOKEN), false, 'state file exposed the GitHub Token after token clear');

      await cdp.clickButton('本地配置');
      await cdp.waitForText('OpenCode');
      await cdp.waitForText('Claude Code');
      await cdp.waitForFunction(`(() => {
        const codex = document.querySelector('input[name="config-target-mode"][value="codex"]');
        const opencode = document.querySelector('input[name="config-target-mode"][value="opencode"]');
        const claude = document.querySelector('input[name="config-target-mode"][value="claude"]');
        return codex instanceof HTMLInputElement
          && opencode instanceof HTMLInputElement
          && claude instanceof HTMLInputElement
          && codex.disabled
          && !opencode.disabled
          && claude.disabled;
      })()`);
      assert.equal(await cdp.inputDisabled('input[name="config-target-mode"][value="codex"]'), true, 'Codex config target was not disabled when its config was missing');
      assert.equal(await cdp.inputDisabled('input[name="config-target-mode"][value="opencode"]'), false, 'OpenCode config target was disabled even though its config existed');
      assert.equal(await cdp.inputDisabled('input[name="config-target-mode"][value="claude"]'), true, 'Claude Code config target was not disabled when its config was missing');
      await cdp.clickSelector('input[name="config-target-mode"][value="opencode"]');
      await assertConfigEditorLayout(cdp);
      await assertButtonVisibleInPanel(cdp, '#config-panel', '刷新远端配置缓存');
      await assertButtonVisibleInPanel(cdp, '#config-panel', '运行 diff');
      await assertButtonVisibleInPanel(cdp, '#config-panel', '执行 dry-run');
      await assertButtonVisibleInPanel(cdp, '#config-panel', '应用所选目标');
      await assertSelectorVisible(cdp, '#local-apply-confirmation');
      await cdp.waitForText('拉取、diff、dry-run 与应用都会使用当前选择的本地配置目标和路径覆盖。');
      await cdp.setInputValue('#config-path-editor', nativePath);
      await cdp.waitForText(nativePath);
      await cdp.clickButton('加载配置');
      await cdp.waitForText('配置已加载');
      await assertConfigEditorLayout(cdp);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 720, deviceScaleFactor: 1, mobile: false });
      await assertConfigEditorLayout(cdp, 'short desktop', true);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await assertConfigEditorLayout(cdp, 'restored desktop');
      const rawConfigText = await cdp.textareaValue('#config-editor');
      assert.equal(rawConfigText.includes(NATIVE_SECRET), true, 'raw config viewer did not show original file content');
      await cdp.setTextareaValue('#config-editor', opencodeNativeJson('gui-editor-secret'));
      await cdp.clickButton('保存配置');
      await cdp.waitForText('配置已保存');
      const nativeAfterEditorSave = await readFile(nativePath, 'utf8');
      assert.equal(nativeAfterEditorSave.includes('gui-editor-secret'), true);

      const localDiffRequestCountBefore = (await cdp.recordedFetchBodies()).filter((request) => request.url === '/api/diff').length;
      assert.equal(await cdp.clickButton('运行 diff'), true, 'local config diff button was not clickable');
      await cdp.waitForFunction(`(() => {
        const requests = window.__agentcfgFetchBodies ?? [];
        return requests.filter((request) => request.url === '/api/diff').length > ${localDiffRequestCountBefore};
      })()`);
      await cdp.waitForText('Diff 已就绪');
      await assertPanelContainsText(cdp, '#config-panel', CACHED_SECRET);
      await assertPanelContainsText(cdp, '#config-panel', 'gui-editor-secret');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/diff'), { statePath, agent: 'opencode', configPath: nativePath });
      await assertDomHasNoGitHubToken(cdp, 'post-local-diff DOM');

      const localPlanRequestCountBefore = (await cdp.recordedFetchBodies()).filter((request) => request.url === '/api/apply/plan').length;
      assert.equal(await cdp.clickButton('执行 dry-run'), true, 'local config dry-run button was not clickable');
      await cdp.waitForFunction(`(() => {
        const requests = window.__agentcfgFetchBodies ?? [];
        return requests.filter((request) => request.url === '/api/apply/plan').length > ${localPlanRequestCountBefore};
      })()`);
      await cdp.waitForText('Dry-run 完成');
      await assertPanelContainsText(cdp, '#config-panel', '当前内容');
      await assertPanelContainsText(cdp, '#config-panel', '应用后内容');
      await assertSelectorVisible(cdp, '.file-diff-editor');
      await assertContainedScrollableBlocks(cdp, '.file-diff-editor', 'local dry-run file diff editor');
      const localDryRunDom = await cdp.bodyText();
      assert.equal(localDryRunDom.includes('gui-editor-secret'), true, 'local dry-run preview did not show current config content');
      assert.equal(localDryRunDom.includes(CACHED_SECRET), true, 'local dry-run preview did not show expected config content');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/apply/plan'), { statePath, agent: 'opencode', configPath: nativePath });
      assert.equal(await cdp.isButtonDisabled('应用所选目标'), true);

      await cdp.setInputValue('#local-apply-confirmation', 'APPLY');
      await cdp.waitForFunction(`(() => {
        const buttons = Array.from(document.querySelectorAll('#config-panel button'));
        const button = buttons.find((candidate) => candidate.textContent?.includes('应用所选目标'));
        return button instanceof HTMLButtonElement && !button.disabled;
      })()`);
      const localApplyRequestCountBefore = (await cdp.recordedFetchBodies()).filter((request) => request.url === '/api/apply').length;
      assert.equal(await cdp.clickButton('应用所选目标'), true, 'local config apply button was not clickable');
      await cdp.waitForFunction(`(() => {
        const requests = window.__agentcfgFetchBodies ?? [];
        return requests.filter((request) => request.url === '/api/apply').length > ${localApplyRequestCountBefore};
      })()`);
      await cdp.waitForText('应用完成');
      await assertPanelContainsText(cdp, '#config-panel', '写入结果');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/apply'), { statePath, agent: 'opencode', configPath: nativePath, confirm: 'APPLY' });
      const nativeAfterLocalApply = await readFile(nativePath, 'utf8');
      assert.equal(nativeAfterLocalApply.includes(CACHED_SECRET), true, 'local config apply did not write cached secret');
      await assertDomHasNoGitHubToken(cdp, 'post-local-apply DOM');

      await cdp.setTextareaValue('#config-editor', opencodeNativeJson('gui-editor-after-local-apply-secret'));
      await cdp.clickButton('保存配置');
      await cdp.waitForText('配置已保存');
      await cdp.clickButton('审阅与应用');
      await cdp.clickButton('运行 diff');
      await cdp.waitForText('Diff 已就绪');
      await cdp.waitForText(CACHED_SECRET);
      await cdp.waitForText('gui-editor-after-local-apply-secret');
      await assertDomHasNoGitHubToken(cdp, 'post-diff DOM');

      await cdp.clickButton('执行 dry-run');
      await cdp.waitForText('Dry-run 完成');
      await cdp.waitForText('当前内容');
      await cdp.waitForText('应用后内容');
      await assertSelectorVisible(cdp, '.file-diff-editor');
      await assertContainedScrollableBlocks(cdp, '.file-diff-editor', 'dry-run file diff editor');
      const dryRunDom = await cdp.bodyText();
      assert.equal(dryRunDom.includes('gui-editor-after-local-apply-secret'), true, 'dry-run preview did not show current config content');
      assert.equal(dryRunDom.includes(CACHED_SECRET), true, 'dry-run preview did not show expected config content');
      assert.equal(await cdp.isButtonDisabled('应用所选目标'), true);

      const planApi = await postJsonText(webServer.url, '/api/apply/plan', { statePath, agent: 'opencode', configPath: nativePath });
      assert.equal(planApi.includes('gui-editor-after-local-apply-secret'), true, 'dry-run API response did not include current config content');
      assert.equal(planApi.includes(CACHED_SECRET), true, 'dry-run API response did not include expected config content');
      assertNoGitHubToken(planApi, 'dry-run API response');

      await cdp.setInputValue('#apply-confirmation', 'APPLY');
      await cdp.clickButton('本地配置');
      await cdp.setTextareaValue('#config-editor', opencodeNativeJson('gui-editor-after-plan-secret'));
      await cdp.clickButton('保存配置');
      await cdp.waitForText('配置已保存');
      await cdp.clickButton('审阅与应用');
      await cdp.waitForText('需要 dry-run');
      assert.equal(await cdp.isButtonDisabled('应用所选目标'), true, 'config save did not invalidate stale dry-run plan');

      await cdp.clickButton('执行 dry-run');
      await cdp.waitForText('Dry-run 完成');
      await assertSelectorVisible(cdp, '.file-diff-editor');
      const refreshedDryRunDom = await cdp.bodyText();
      assert.equal(refreshedDryRunDom.includes('gui-editor-after-plan-secret'), true, 'rerun dry-run did not refresh current config content');
      assert.equal(refreshedDryRunDom.includes(CACHED_SECRET), true, 'rerun dry-run did not show expected config content');

      await cdp.setInputValue('#apply-confirmation', 'APPLY');
      await cdp.waitForFunction(`(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const button = buttons.find((candidate) => candidate.textContent?.includes('应用所选目标'));
        return button instanceof HTMLButtonElement && !button.disabled;
      })()`);
      await cdp.clickButton('应用所选目标');
      await cdp.waitForText('应用完成');

      const nativeAfterApply = await readFile(nativePath, 'utf8');
      assert.equal(nativeAfterApply.includes(CACHED_SECRET), true);
      assert.equal(nativeAfterApply.includes(NATIVE_SECRET), false);

      await cdp.clickSelector('input[name="target-mode"][value="all"]');
      await cdp.setInputValue('#config-path', allTargetsDirectory);
      assert.equal(await cdp.clickButton('执行 dry-run'), true, 'all-agent dry-run button was not clickable');
      await cdp.waitForText('Dry-run 完成');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/apply/plan'), { statePath, allAgents: true, configPath: allTargetsDirectory });
      assert.equal(await cdp.isButtonDisabled('应用所选目标'), true, 'all-agent apply unlocked before confirmation');
      await cdp.clickButton('本地配置');
      await assertSelectorVisible(cdp, '#local-apply-confirmation');
      assert.equal(await cdp.inputDisabled('#local-apply-confirmation'), true, 'local confirmation accepted an all-agent dry-run plan');
      assert.equal(await cdp.isButtonDisabled('应用所选目标'), true, 'local apply unlocked for an all-agent dry-run plan');
      await cdp.clickButton('审阅与应用');
      assert.equal(await cdp.isButtonDisabled('应用所选目标'), true, 'execute apply unlocked without direct confirmation after visiting local config');

      const codexDiffApi = JSON.parse(await postJsonText(webServer.url, '/api/diff', { statePath, agent: 'codex', configPath: codexNativePath })) as CodexNoticeApiEnvelope;
      assert.equal(codexDiffApi.ok, true, 'Codex diff API response failed');
      assert.deepEqual(codexDiffApi.data.results[0]?.changes, [], 'Codex diff notices affected change rows');
      assertCodexNoticePayload(codexDiffApi.data.results[0]?.notices, 'Codex diff API notices');
      const codexPlanApi = JSON.parse(await postJsonText(webServer.url, '/api/apply/plan', { statePath, agent: 'codex', configPath: codexNativePath })) as CodexNoticeApiEnvelope;
      assert.equal(codexPlanApi.ok, true, 'Codex plan API response failed');
      assert.equal(codexPlanApi.data.plans?.[0]?.operationCount, 0, 'Codex plan notices affected operation count');
      assert.equal(codexPlanApi.data.results[0]?.status, 'unchanged', 'Codex plan notices affected status');
      assertCodexNoticePayload(codexPlanApi.data.plans?.[0]?.notices, 'Codex plan API notices');
      assertCodexNoticePayload(codexPlanApi.data.results[0]?.notices, 'Codex dry-run result API notices');
      const codexApplyApi = JSON.parse(await postJsonText(webServer.url, '/api/apply', { statePath, agent: 'codex', configPath: codexNativePath, confirm: 'APPLY' })) as CodexNoticeApiEnvelope;
      assert.equal(codexApplyApi.ok, true, 'Codex apply API response failed');
      assert.equal(codexApplyApi.data.results[0]?.status, 'unchanged', 'Codex apply notices affected status');
      assertCodexNoticePayload(codexApplyApi.data.results[0]?.notices, 'Codex apply API notices');
      assertNoGitHubToken(JSON.stringify(codexDiffApi), 'Codex diff API response');
      assertNoGitHubToken(JSON.stringify(codexPlanApi), 'Codex dry-run API response');
      assertNoGitHubToken(JSON.stringify(codexApplyApi), 'Codex apply API response');

      await cdp.clickSelector('input[name="target-mode"][value="codex"]');
      await cdp.setInputValue('#config-path', codexNativePath);
      await cdp.waitForFunction(`(() => {
        const target = document.querySelector('input[name="target-mode"][value="codex"]');
        const pathInput = document.querySelector('#config-path');
        return target instanceof HTMLInputElement
          && target.checked
          && pathInput instanceof HTMLInputElement
          && pathInput.value === ${JSON.stringify(codexNativePath)};
      })()`);
      const diffRequestCountBeforeCodex = (await cdp.recordedFetchBodies()).filter((request) => request.url === '/api/diff').length;
      assert.equal(await cdp.clickButton('运行 diff'), true, 'Codex diff button was not clickable');
      await cdp.waitForFunction(`(() => {
        const requests = window.__agentcfgFetchBodies ?? [];
        return requests.filter((request) => request.url === '/api/diff').length > ${diffRequestCountBeforeCodex};
      })()`);
      assert.equal((await lastRecordedJsonBody(cdp, '/api/diff')).agent, 'codex', 'Codex UI diff did not target Codex');
      await cdp.waitForText('Limit Context');
      await cdp.waitForText('Limit Input');
      await cdp.waitForText('Limit Output');
      await cdp.waitForText('unsupported-native-mapping');
      await cdp.waitForText('Codex has no official native mapping for contextWindow');
      assert.equal((await cdp.bodyText()).includes('未变化'), true, 'Codex notice-only diff did not remain unchanged');
      await assertDomHasNoGitHubToken(cdp, 'post-Codex-diff DOM');

      assert.equal(await cdp.clickButton('执行 dry-run'), true, 'Codex dry-run button was not clickable');
      await cdp.waitForText('Dry-run 完成');
      await cdp.waitForText('0 项操作');
      await cdp.waitForText('Codex has no official native mapping for contextTokens');
      assert.equal((await cdp.bodyText()).includes('不会更改任何文件。'), true, 'Codex notice-only dry-run did not keep zero operations');
      await assertDomHasNoGitHubToken(cdp, 'post-Codex-dry-run DOM');

      await cdp.setInputValue('#apply-confirmation', 'APPLY');
      assert.equal(await cdp.clickButton('应用所选目标'), true, 'Codex apply button was not clickable');
      await cdp.waitForText('应用完成');
      await cdp.waitForText('Codex has no official native mapping for maxTokens');
      assert.equal((await cdp.bodyText()).includes('无变化'), true, 'Codex notice-only apply did not remain unchanged');
      await cdp.waitForFunction('document.querySelectorAll(".managed-notice-list").length >= 3');
      await assertDomHasNoGitHubToken(cdp, 'post-Codex-apply DOM');
      assert.equal(await readFile(codexNativePath, 'utf8'), codexNativeToml(), 'Codex apply wrote unsupported metadata to native config');
      assert.equal(await readFile(codexEnvPath, 'utf8'), `AGENTCFG_OPENAI_API_KEY=${CACHED_SECRET}\n`, 'Codex apply rewrote unchanged env config');

      await assertNoFixtureRootInUiRequests(cdp);
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
    await restartedWebServer?.close();
    await webServer?.close();
    await fakeGist?.close();
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

type CdpResponse<T> = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: T;
  error?: { message: string };
};

type CdpWebSocket = {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void, options?: { once?: boolean }): void;
  close(): void;
  send(data: string): void;
};

type PendingCdpCommand = {
  resolve(value: unknown): void;
  reject(error: Error): void;
};

type CodexNoticeApiEnvelope = {
  ok: true;
  data: {
    results: Array<{
      changes?: unknown[];
      notices?: CodexNotice[];
      status?: string;
    }>;
    plans?: Array<{
      notices?: CodexNotice[];
      operationCount?: number;
    }>;
  };
};

type CodexNotice = {
  field: string;
  code: string;
  message: string;
};

class CdpPage {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCdpCommand>();

  constructor(private readonly socket: CdpWebSocket) {
    socket.addEventListener('message', (event) => this.handleMessage(event.data));
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;

    return new Promise<T>((resolvePromise, rejectPromise) => {
      this.pending.set(id, {
        resolve: (value) => resolvePromise(value as T),
        reject: rejectPromise,
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.send<{ result: { value?: T }; exceptionDetails?: { text?: string } }>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails !== undefined) {
      throw new Error(response.exceptionDetails.text ?? 'Runtime.evaluate failed');
    }
    return response.result.value as T;
  }

  async installFetchRecorder(): Promise<boolean> {
    const source = `(() => {
      if (window.__agentcfgFetchRecorderInstalled === true) {
        return true;
      }
      const originalFetch = window.fetch.bind(window);
      const requests = [];
      Object.defineProperty(window, '__agentcfgFetchBodies', { value: requests, configurable: true });
      Object.defineProperty(window, '__agentcfgFetchRecorderInstalled', { value: true, configurable: true });
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const body = typeof init?.body === 'string' ? init.body : undefined;
        requests.push({ url, body });
        return originalFetch(input, init);
      };
      return true;
    })()`;
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
    return this.evaluate<boolean>(source);
  }

  recordedFetchBodies(): Promise<Array<{ url: string; body?: string }>> {
    return this.evaluate<Array<{ url: string; body?: string }>>(`window.__agentcfgFetchBodies ?? []`);
  }

  async waitForFunction(expression: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.evaluate<boolean>(expression)) {
        return;
      }
      await delay(50);
    }
    throw new Error(`Timed out waiting for browser condition: ${expression}`);
  }

  waitForText(text: string, timeoutMs = 5000): Promise<void> {
    return this.waitForFunction(`document.body?.innerText.includes(${JSON.stringify(text)}) === true`, timeoutMs);
  }

  setInputValue(selector: string, value: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  setTextareaValue(selector: string, value: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const textarea = document.querySelector(${JSON.stringify(selector)});
      if (!(textarea instanceof HTMLTextAreaElement)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      descriptor?.set?.call(textarea, ${JSON.stringify(value)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  selectValue(selector: string, value: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const select = document.querySelector(${JSON.stringify(selector)});
      if (!(select instanceof HTMLSelectElement)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      descriptor?.set?.call(select, ${JSON.stringify(value)});
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
  }

  submitForm(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const form = document.querySelector(${JSON.stringify(selector)});
      if (!(form instanceof HTMLFormElement)) return false;
      form.requestSubmit();
      return true;
    })()`);
  }

  clickSelector(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return false;
      element.click();
      return true;
    })()`);
  }

  clickButton(text: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}));
      if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
      button.click();
      return true;
    })()`);
  }

  isButtonDisabled(text: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find((candidate) => candidate.textContent?.includes(${JSON.stringify(text)}));
      return button instanceof HTMLButtonElement && button.disabled;
    })()`);
  }

  inputDisabled(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      return input instanceof HTMLInputElement && input.disabled;
    })()`);
  }

  bodyText(): Promise<string> {
    return this.evaluate<string>('document.body?.innerText ?? ""');
  }

  textContent(selector: string): Promise<string> {
    return this.evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
  }

  inputValue(selector: string): Promise<string> {
    return this.evaluate<string>(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      return input instanceof HTMLInputElement ? input.value : '';
    })()`);
  }

  textareaValue(selector: string): Promise<string> {
    return this.evaluate<string>(`(() => {
      const textarea = document.querySelector(${JSON.stringify(selector)});
      return textarea instanceof HTMLTextAreaElement ? textarea.value : '';
    })()`);
  }

  selectorVisible(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    })()`);
  }

  async close(): Promise<void> {
    this.socket.close();
  }

  private handleMessage(data: unknown): void {
    const message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf8')) as CdpResponse<unknown>;
    if (message.id === undefined) {
      return;
    }
    const pendingCommand = this.pending.get(message.id);
    if (pendingCommand === undefined) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error !== undefined) {
      pendingCommand.reject(new Error(message.error.message));
      return;
    }
    pendingCommand.resolve(message.result);
  }
}

async function openCdpPage(port: number, url: string): Promise<CdpPage> {
  await waitForChrome(port);
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!response.ok) {
    throw new Error(`Chrome target creation failed with ${response.status}`);
  }
  const target = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (target.webSocketDebuggerUrl === undefined) {
    throw new Error('Chrome target did not return a websocket URL');
  }
  return new CdpPage(await connectWebSocket(target.webSocketDebuggerUrl));
}

function connectWebSocket(url: string): Promise<CdpWebSocket> {
  const WebSocketConstructor = (globalThis as unknown as { WebSocket?: new (url: string) => CdpWebSocket }).WebSocket;
  if (WebSocketConstructor === undefined) {
    throw new Error('This Node.js runtime does not expose a global WebSocket client for CDP');
  }
  const socket = new WebSocketConstructor(url);
  return new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener('open', () => resolvePromise(socket), { once: true });
    socket.addEventListener('error', () => rejectPromise(new Error('Chrome CDP websocket failed to connect')), { once: true });
  });
}

function launchChrome(port: number, userDataDir: string, home: string | undefined = process.env.HOME): ChildProcessWithoutNullStreams {
  const env = { ...process.env };
  if (home === undefined) {
    delete env.HOME;
  } else {
    env.HOME = home;
  }

  return spawn(CHROME_PATH, [
    '--headless=new',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-gpu',
    '--no-default-browser-check',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { env });
}

async function waitForProcessExit(childProcess: ChildProcessWithoutNullStreams): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(() => {
      childProcess.kill('SIGKILL');
      resolvePromise();
    }, 3000);
    childProcess.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function waitForChrome(port: number): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(50);
    }
  }
  throw new Error('Timed out waiting for Chrome remote debugging endpoint');
}

async function getFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  await new Promise<void>((resolvePromise, rejectPromise) => server.close((error) => (error ? rejectPromise(error) : resolvePromise())));
  if (address === null || typeof address === 'string') {
    throw new Error('Could not allocate a local Chrome debugging port');
  }
  return address.port;
}

async function requestText(baseUrl: string, path: string): Promise<string> {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.ok, true);
  return response.text();
}

async function postJsonText(baseUrl: string, path: string, body: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.ok, true);
  return response.text();
}

async function assertDomHasNoGitHubToken(cdp: CdpPage, label: string): Promise<void> {
  assertNoGitHubToken(await cdp.bodyText(), label);
}

async function assertBrowserStorageHasNoSecretsOrStatePath(cdp: CdpPage, statePath: string, label: string): Promise<void> {
  const storage = await cdp.evaluate<{ href: string; localStorage: Record<string, string>; sessionStorage: Record<string, string> }>(`(() => {
    const readStorage = (storage) => Object.fromEntries(Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? '';
      return [key, storage.getItem(key) ?? ''];
    }));
    return {
      href: window.location.href,
      localStorage: readStorage(window.localStorage),
      sessionStorage: readStorage(window.sessionStorage),
    };
  })()`);

  const serializedStorage = JSON.stringify(storage);
  assertNoGitHubToken(serializedStorage, label);
  assert.equal(serializedStorage.includes(statePath), false, `${label} persisted the state path in browser storage`);
  assert.equal(serializedStorage.includes('statePath'), false, `${label} persisted a statePath key in browser storage`);
}

async function assertSavedGitHubTokenLocked(cdp: CdpPage, label: string): Promise<void> {
  const input = await cdp.evaluate<{ disabled: boolean; type: string; value: string }>(`(() => {
    const input = document.querySelector('#github-token');
    return input instanceof HTMLInputElement
      ? { disabled: input.disabled, type: input.type, value: input.value }
      : { disabled: false, type: '', value: '' };
  })()`);

  assert.equal(input.type, 'password', `${label} did not render as a password input`);
  assert.equal(input.disabled, true, `${label} was not disabled`);
  assert.equal(input.value, SAVED_GITHUB_TOKEN_MASK, `${label} did not show the fixed mask`);
  assert.equal(input.value.includes(GITHUB_TOKEN), false, `${label} exposed the raw GitHub Token`);
}

async function assertGitHubTokenEditable(cdp: CdpPage, label: string): Promise<void> {
  const input = await cdp.evaluate<{ disabled: boolean; type: string; value: string }>(`(() => {
    const input = document.querySelector('#github-token');
    return input instanceof HTMLInputElement
      ? { disabled: input.disabled, type: input.type, value: input.value }
      : { disabled: true, type: '', value: 'missing' };
  })()`);

  assert.equal(input.type, 'password', `${label} did not render as a password input`);
  assert.equal(input.disabled, false, `${label} was not editable`);
  assert.equal(input.value, '', `${label} was not empty`);
}

async function assertSelectorVisible(cdp: CdpPage, selector: string): Promise<void> {
  assert.equal(await cdp.selectorVisible(selector), true, `${selector} was not visible`);
}

async function assertSelectorNotVisible(cdp: CdpPage, selector: string): Promise<void> {
  assert.equal(await cdp.selectorVisible(selector), false, `${selector} should not be visible`);
}

async function assertButtonVisibleBeforeScroll(cdp: CdpPage, panelSelector: string, buttonText: string): Promise<void> {
  const state = await cdp.evaluate<{ found: boolean; visible: boolean; top: number; bottom: number; viewportTop: number; viewportBottom: number }>(`(() => {
    const viewport = document.querySelector('.tab-viewport');
    if (viewport instanceof HTMLElement) {
      viewport.scrollTop = 0;
    }
    const panel = document.querySelector(${JSON.stringify(panelSelector)});
    const button = Array.from(panel?.querySelectorAll('button') ?? []).find((candidate) => candidate.textContent?.includes(${JSON.stringify(buttonText)}));
    const viewportRect = viewport instanceof HTMLElement ? viewport.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    if (!(button instanceof HTMLButtonElement)) {
      return { found: false, visible: false, top: 0, bottom: 0, viewportTop: viewportRect.top, viewportBottom: viewportRect.bottom };
    }
    const rect = button.getBoundingClientRect();
    const style = window.getComputedStyle(button);
    const tolerance = 1;
    return {
      found: true,
      visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.top >= viewportRect.top - tolerance && rect.bottom <= viewportRect.bottom + tolerance,
      top: rect.top,
      bottom: rect.bottom,
      viewportTop: viewportRect.top,
      viewportBottom: viewportRect.bottom,
    };
  })()`);
  assert.equal(state.found, true, `${buttonText} was not rendered in ${panelSelector}`);
  assert.equal(state.visible, true, `${buttonText} was not visible before scrolling: ${JSON.stringify(state)}`);
}

async function assertButtonVisibleInPanel(cdp: CdpPage, panelSelector: string, buttonText: string): Promise<void> {
  const visible = await cdp.evaluate<boolean>(`(() => {
    const panel = document.querySelector(${JSON.stringify(panelSelector)});
    const button = Array.from(panel?.querySelectorAll('button') ?? []).find((candidate) => candidate.textContent?.includes(${JSON.stringify(buttonText)}));
    if (!(button instanceof HTMLButtonElement)) return false;
    const style = window.getComputedStyle(button);
    return style.display !== 'none' && style.visibility !== 'hidden' && button.getClientRects().length > 0;
  })()`);
  assert.equal(visible, true, `${buttonText} was not visible in ${panelSelector}`);
}

async function assertPanelContainsText(cdp: CdpPage, panelSelector: string, text: string): Promise<void> {
  await cdp.waitForFunction(`document.querySelector(${JSON.stringify(panelSelector)})?.textContent?.includes(${JSON.stringify(text)}) === true`);
}

async function assertNoRemoteBottomActions(cdp: CdpPage): Promise<void> {
  const hasBottomActions = await cdp.evaluate<boolean>(`document.querySelector('.remote-config-form .remote-actions') !== null`);
  assert.equal(hasBottomActions, false, 'remote load/save controls still rendered in the bottom remote-actions block');
}

async function switchRemoteConfigView(cdp: CdpPage, view: 'editor' | 'preview'): Promise<void> {
  const selector = view === 'editor' ? '#remote-view-editor' : '#remote-view-preview';
  assert.equal(await cdp.clickSelector(selector), true, `${selector} was not clickable`);
  await cdp.waitForFunction(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') === 'true'`);
  if (view === 'editor') {
    await assertRemoteEditorMode(cdp);
  } else {
    await assertSelectorVisible(cdp, '#remote-yaml-preview');
    await assertSelectorVisible(cdp, '#remote-schema-preview');
    await assertSelectorNotVisible(cdp, '#remote-provider');
  }
}

async function assertRemoteEditorMode(cdp: CdpPage): Promise<void> {
  await assertSelectorVisible(cdp, '#remote-provider');
  await assertSelectorVisible(cdp, '#remote-api-key');
  await assertSelectorNotVisible(cdp, '#remote-yaml-preview');
  await assertSelectorNotVisible(cdp, '#remote-schema-preview');
  const activeEditor = await cdp.evaluate<boolean>(`document.querySelector('#remote-view-editor')?.getAttribute('aria-pressed') === 'true'`);
  assert.equal(activeEditor, true, 'remote config did not default to editor mode');
}

async function assertFixtureRootControlHidden(cdp: CdpPage): Promise<void> {
  const fixtureControlPresent = await cdp.evaluate<boolean>(`document.body?.innerText.includes('Fixture root optional') === true || document.querySelector('#fixtures-root') !== null`);
  assert.equal(fixtureControlPresent, false, 'production GUI exposed a fixture root control');
}

async function assertNoDesktopFrame(cdp: CdpPage): Promise<void> {
  const frame = await cdp.evaluate<{ shellPresent: boolean; controlsPresent: boolean }>(`(() => {
    return {
      shellPresent: document.querySelector('.desktop-window') !== null,
      controlsPresent: document.querySelector('.window-controls, .window-control') !== null,
    };
  })()`);
  assert.equal(frame.shellPresent, false, 'desktop shell wrapper was still rendered');
  assert.equal(frame.controlsPresent, false, 'desktop traffic-light controls were still rendered');
}

async function assertRemotePreviewLayout(cdp: CdpPage): Promise<void> {
  const preview = await cdp.evaluate<{ yamlHeight: number; schemaHeight: number; contained: boolean; overflowReady: boolean; stacked: boolean; fullWidth: boolean; formHidden: boolean; details: string[] }>(`(() => {
    const rectContains = (parent, child) => {
      if (!(parent instanceof HTMLElement) || !(child instanceof HTMLElement)) return false;
      const parentRect = parent.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();
      const tolerance = 1;
      return childRect.left >= parentRect.left - tolerance && childRect.top >= parentRect.top - tolerance && childRect.right <= parentRect.right + tolerance && childRect.bottom <= parentRect.bottom + tolerance;
    };
    const yaml = document.querySelector('#remote-yaml-preview');
    const schema = document.querySelector('#remote-schema-preview');
    const stack = document.querySelector('.remote-preview-stack');
    const layout = document.querySelector('.remote-config-layout');
    const yamlRect = yaml instanceof HTMLElement ? yaml.getBoundingClientRect() : null;
    const schemaRect = schema instanceof HTMLElement ? schema.getBoundingClientRect() : null;
    const stackRect = stack instanceof HTMLElement ? stack.getBoundingClientRect() : null;
    const layoutRect = layout instanceof HTMLElement ? layout.getBoundingClientRect() : null;
    const blocks = [yaml, schema].filter((block) => block instanceof HTMLElement);
    return {
      yamlHeight: yamlRect?.height ?? 0,
      schemaHeight: schemaRect?.height ?? 0,
      contained: blocks.every((block) => rectContains(block.parentElement, block)),
      stacked: yamlRect !== null && schemaRect !== null && yamlRect.bottom <= schemaRect.top,
      fullWidth: stackRect !== null && layoutRect !== null && stackRect.width >= layoutRect.width * 0.96,
      formHidden: document.querySelector('#remote-provider') === null,
      details: blocks.map((block) => {
        const parentRect = block.parentElement?.getBoundingClientRect();
        const blockRect = block.getBoundingClientRect();
        return JSON.stringify({
          id: block.id,
          parentHeight: parentRect?.height ?? 0,
          blockTop: blockRect.top,
          blockBottom: blockRect.bottom,
          parentTop: parentRect?.top ?? 0,
          parentBottom: parentRect?.bottom ?? 0,
          blockHeight: blockRect.height,
        });
      }),
      overflowReady: blocks.every((block) => {
        const style = window.getComputedStyle(block);
        return style.overflowX !== 'visible' && style.overflowY !== 'visible' && style.minWidth === '0px' && style.maxWidth === '100%';
      }),
    };
  })()`);
  assert.equal(preview.yamlHeight > 0, true, 'remote YAML preview was not visible');
  assert.equal(preview.schemaHeight > 0, true, 'remote schema preview was not visible');
  assert.equal(preview.formHidden, true, 'remote editor was visible alongside preview');
  assert.equal(preview.stacked, true, 'remote YAML and schema previews were not stacked');
  assert.equal(preview.fullWidth, true, 'remote preview did not expand to the full remote config width');
  assert.equal(preview.contained, true, `remote preview block visibly overflowed its card: ${preview.details.join(', ')}`);
  assert.equal(preview.overflowReady, true, 'remote preview block was not configured for internal scrolling');
}

async function assertSchemaReferenceTree(cdp: CdpPage): Promise<void> {
  const tree = await cdp.evaluate<{
    treePresent: boolean;
    flatFieldCount: number;
    paths: string[];
    providerContainsApiKey: boolean;
    modelContainsContextWindow: boolean;
    providerOpenedAfterSummaryClick: boolean;
    metadataText: string;
  }>(`(() => {
    const preview = document.querySelector('#remote-schema-preview');
    const nodes = Array.from(preview?.querySelectorAll('details.schema-docs__node') ?? []);
    const pathFor = (node) => node instanceof HTMLElement ? node.dataset.schemaPath ?? '' : '';
    const byPath = (path) => nodes.find((node) => pathFor(node) === path);
    const providerNode = byPath('providers.<provider>');
    if (providerNode instanceof HTMLDetailsElement) {
      providerNode.open = false;
      providerNode.querySelector('summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    return {
      treePresent: preview?.querySelector('.schema-docs__tree') !== null,
      flatFieldCount: preview?.querySelectorAll('.schema-docs__field').length ?? 0,
      paths: nodes.map(pathFor),
      providerContainsApiKey: byPath('providers.<provider>.apiKey')?.parentElement?.closest('details[data-schema-path="providers.<provider>"]') !== null,
      modelContainsContextWindow: byPath('providers.<provider>.models.<model>.contextWindow')?.parentElement?.closest('details[data-schema-path="providers.<provider>.models.<model>"]') !== null,
      providerOpenedAfterSummaryClick: providerNode instanceof HTMLDetailsElement && providerNode.open,
      metadataText: preview?.textContent ?? '',
    };
  })()`);

  assert.equal(tree.treePresent, true, 'schema reference did not render a tree root');
  assert.equal(tree.flatFieldCount, 0, 'schema reference still rendered one flat card per field');
  for (const path of [
    'schemaVersion',
    'defaults',
    'defaults.provider',
    'providers',
    'providers.<provider>',
    'providers.<provider>.apiKey',
    'providers.<provider>.apiKey.type',
    'providers.<provider>.models.<model>',
    'providers.<provider>.models.<model>.contextWindow',
  ]) {
    assert.ok(tree.paths.includes(path), `missing schema tree node: ${path}`);
  }
  assert.equal(tree.providerContainsApiKey, true, 'provider API key node was not nested under provider config');
  assert.equal(tree.modelContainsContextWindow, true, 'contextWindow node was not nested under model config');
  assert.equal(tree.providerOpenedAfterSummaryClick, true, 'schema tree provider node did not expand from its summary');
  assert.match(tree.metadataText, /必填/);
  assert.match(tree.metadataText, /可选/);
  assert.match(tree.metadataText, /类型：/);
}

async function assertConfigEditorLayout(cdp: CdpPage, label = 'desktop', expectTabViewportScroll = false): Promise<void> {
  const layout = await cdp.evaluate<{
    label: string;
    toolbarChildren: number;
    toolbarColumns: number;
    standaloneToolbarActions: boolean;
    nestedActions: boolean;
    actionsInsidePathForm: boolean;
    buttonRows: number;
    textareaHeight: number;
    textareaInsideCard: boolean;
    textareaInsideEditorBody: boolean;
    textareaInsideViewport: boolean;
    textareaBottomPainted: boolean;
    textareaInternalScroll: boolean;
    textareaOverflowReady: boolean;
    tabViewportScrollOwner: boolean;
    tabViewportCanScroll: boolean;
    dashboardCompetesForScroll: boolean;
    cardClipsOverflow: boolean;
    hiddenEditorAncestors: string[];
    textareaDetails: string;
  }>(`(() => {
    const rectContains = (parent, child) => {
      if (!(parent instanceof HTMLElement) || !(child instanceof HTMLElement)) return false;
      const parentRect = parent.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();
      const tolerance = 1;
      return childRect.left >= parentRect.left - tolerance && childRect.top >= parentRect.top - tolerance && childRect.right <= parentRect.right + tolerance && childRect.bottom <= parentRect.bottom + tolerance;
    };
    const rectObject = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
    };
    const clippingOverflow = (style) => ['hidden', 'clip'].includes(style.overflowX) || ['hidden', 'clip'].includes(style.overflowY);
    const tabViewport = document.querySelector('.tab-viewport');
    const dashboard = document.querySelector('#config-panel');
    const toolbar = document.querySelector('.config-editor-toolbar');
    const pathForm = document.querySelector('.config-editor-toolbar .path-form');
    const actions = document.querySelector('.config-editor-toolbar .path-form .review-actions');
    const editorBody = document.querySelector('.config-editor-body');
    const meta = document.querySelector('.config-editor-meta');
    const textarea = document.querySelector('#config-editor');
    const card = document.querySelector('.config-editor-card');
    if (tabViewport instanceof HTMLElement) {
      tabViewport.scrollTop = tabViewport.scrollHeight;
    }
    const buttons = Array.from(actions?.querySelectorAll('button') ?? []);
    const buttonTops = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    const originalTextareaValue = textarea instanceof HTMLTextAreaElement ? textarea.value : '';
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.value = Array.from({ length: 180 }, (_, index) => String(index) + ': ' + 'long-config-token'.repeat(18)).join(String.fromCharCode(10));
    }
    const textareaInternalScroll = textarea instanceof HTMLTextAreaElement ? textarea.scrollWidth > textarea.clientWidth && textarea.scrollHeight > textarea.clientHeight : false;
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.value = originalTextareaValue;
    }
    const textareaStyle = textarea instanceof HTMLElement ? window.getComputedStyle(textarea) : null;
    const cardStyle = card instanceof HTMLElement ? window.getComputedStyle(card) : null;
    const tabViewportStyle = tabViewport instanceof HTMLElement ? window.getComputedStyle(tabViewport) : null;
    const dashboardStyle = dashboard instanceof HTMLElement ? window.getComputedStyle(dashboard) : null;
    const gridColumns = toolbar instanceof HTMLElement ? window.getComputedStyle(toolbar).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    const cardRect = card instanceof HTMLElement ? card.getBoundingClientRect() : null;
    const textareaRect = textarea instanceof HTMLElement ? textarea.getBoundingClientRect() : null;
    const tabViewportRect = tabViewport instanceof HTMLElement ? tabViewport.getBoundingClientRect() : null;
    const dashboardRect = dashboard instanceof HTMLElement ? dashboard.getBoundingClientRect() : null;
    const viewportTolerance = 1;
    const visibleBottom = tabViewportRect === null ? window.innerHeight : Math.min(window.innerHeight, tabViewportRect.bottom);
    const visibleTop = tabViewportRect === null ? 0 : Math.max(0, tabViewportRect.top);
    const textareaInsideVisibleViewport = textareaRect !== null && textareaRect.top >= visibleTop - viewportTolerance && textareaRect.bottom <= visibleBottom + viewportTolerance;
    const paintX = textareaRect === null ? 0 : Math.min(Math.max(textareaRect.left + textareaRect.width / 2, 1), window.innerWidth - 1);
    const paintY = textareaRect === null ? 0 : Math.min(Math.max(textareaRect.bottom - 1, 1), window.innerHeight - 1);
    const paintedElement = document.elementFromPoint(paintX, paintY);
    const hiddenEditorAncestors = [];
    let ancestor = textarea instanceof HTMLElement ? textarea.parentElement : null;
    while (ancestor instanceof HTMLElement && ancestor !== tabViewport) {
      const style = window.getComputedStyle(ancestor);
      if (clippingOverflow(style)) {
        hiddenEditorAncestors.push(ancestor.id === '' ? ancestor.className || ancestor.tagName.toLowerCase() : '#' + ancestor.id);
      }
      ancestor = ancestor.parentElement;
    }
    return {
      label: ${JSON.stringify(label)},
      toolbarChildren: toolbar instanceof HTMLElement ? toolbar.children.length : 0,
      toolbarColumns: gridColumns,
      standaloneToolbarActions: toolbar instanceof HTMLElement ? toolbar.querySelector(':scope > .review-actions') !== null : true,
      nestedActions: pathForm instanceof HTMLElement ? pathForm.querySelector(':scope > .review-actions') !== null : false,
      actionsInsidePathForm: pathForm instanceof HTMLElement && actions instanceof HTMLElement ? rectContains(pathForm, actions) : false,
      buttonRows: buttonTops.size,
      textareaInsideCard: card instanceof HTMLElement && textarea instanceof HTMLElement ? rectContains(card, textarea) : false,
      textareaInsideEditorBody: editorBody instanceof HTMLElement && textarea instanceof HTMLElement ? rectContains(editorBody, textarea) : false,
      textareaInsideViewport: textareaInsideVisibleViewport,
      textareaBottomPainted: textarea instanceof HTMLElement && paintedElement === textarea,
      textareaHeight: textarea instanceof HTMLElement ? textarea.getBoundingClientRect().height : 0,
      textareaInternalScroll,
      textareaOverflowReady: textareaStyle !== null && textareaStyle.display === 'block' && textareaStyle.overflowX !== 'visible' && textareaStyle.overflowY !== 'visible' && textareaStyle.minWidth === '0px' && textareaStyle.maxWidth === '100%' && textareaStyle.width !== 'auto' && textareaStyle.height !== 'auto',
      tabViewportScrollOwner: tabViewportStyle !== null && ['auto', 'scroll'].includes(tabViewportStyle.overflowY),
      tabViewportCanScroll: tabViewport instanceof HTMLElement ? tabViewport.scrollHeight > tabViewport.clientHeight : false,
      dashboardCompetesForScroll: dashboardStyle !== null && (['auto', 'scroll'].includes(dashboardStyle.overflowY) || dashboardStyle.height === '100%'),
      cardClipsOverflow: cardStyle !== null && (cardStyle.overflowX === 'hidden' || cardStyle.overflowY === 'hidden'),
      hiddenEditorAncestors,
      textareaDetails: JSON.stringify({
        label: ${JSON.stringify(label)},
        appShell: rectObject(document.querySelector('.app-shell')),
        tabViewport: rectObject(tabViewport),
        dashboard: rectObject(dashboard),
        card: rectObject(card),
        toolbar: rectObject(toolbar),
        meta: rectObject(meta),
        editorBody: rectObject(editorBody),
        cardTop: cardRect?.top ?? 0,
        cardBottom: cardRect?.bottom ?? 0,
        cardHeight: cardRect?.height ?? 0,
        dashboardHeight: dashboardRect?.height ?? 0,
        tabViewportHeight: tabViewportRect?.height ?? 0,
        viewportHeight: window.innerHeight,
        textareaTop: textareaRect?.top ?? 0,
        textareaBottom: textareaRect?.bottom ?? 0,
        textareaHeight: textareaRect?.height ?? 0,
        paintX,
        paintY,
        paintedElement: paintedElement instanceof HTMLElement ? paintedElement.id || paintedElement.className || paintedElement.tagName.toLowerCase() : null,
        tabViewportOverflowY: tabViewportStyle?.overflowY ?? '',
        dashboardOverflowY: dashboardStyle?.overflowY ?? '',
        dashboardComputedHeight: dashboardStyle?.height ?? '',
        tabViewportScrollHeight: tabViewport instanceof HTMLElement ? tabViewport.scrollHeight : 0,
        tabViewportClientHeight: tabViewport instanceof HTMLElement ? tabViewport.clientHeight : 0,
        dashboardScrollHeight: dashboard instanceof HTMLElement ? dashboard.scrollHeight : 0,
        dashboardClientHeight: dashboard instanceof HTMLElement ? dashboard.clientHeight : 0,
        cardOverflowX: cardStyle?.overflowX ?? '',
        cardOverflowY: cardStyle?.overflowY ?? '',
        hiddenEditorAncestors,
      }),
    };
  })()`);
  assert.equal(layout.toolbarChildren, 2, `${label}: config toolbar should have exactly target and path/control columns`);
  assert.equal(layout.toolbarColumns, 2, `${label}: config toolbar should render as two columns on desktop`);
  assert.equal(layout.standaloneToolbarActions, false, `${label}: config action buttons regressed into a standalone toolbar panel`);
  assert.equal(layout.nestedActions, true, `${label}: config action buttons were not integrated into the path/control panel`);
  assert.equal(layout.actionsInsidePathForm, true, `${label}: config action buttons overflowed the path/control panel`);
  assert.equal(layout.buttonRows <= 2, true, `${label}: config action buttons wrapped unpredictably`);
  assert.equal(layout.tabViewportScrollOwner, true, `${label}: tab viewport was not the page-level scroll owner: ${layout.textareaDetails}`);
  assert.equal(layout.dashboardCompetesForScroll, false, `${label}: dashboard grid became a competing fixed scroll container: ${layout.textareaDetails}`);
  if (expectTabViewportScroll) {
    assert.equal(layout.tabViewportCanScroll, true, `${label}: tab viewport did not scroll on a short desktop viewport: ${layout.textareaDetails}`);
  }
  assert.equal(layout.textareaHeight >= 220, true, `${label}: config editor did not receive enough usable height: ${layout.textareaDetails}`);
  assert.equal(layout.cardClipsOverflow, false, `${label}: config editor card must not hide overflow as a layout fix: ${layout.textareaDetails}`);
  assert.deepEqual(layout.hiddenEditorAncestors, [], `${label}: hidden ancestors would clip the config editor: ${layout.textareaDetails}`);
  assert.equal(layout.textareaInsideEditorBody, true, `${label}: config editor textarea escaped the editor body row: ${layout.textareaDetails}`);
  assert.equal(layout.textareaInsideCard, true, `${label}: config editor textarea visibly overflowed its card: ${layout.textareaDetails}`);
  assert.equal(layout.textareaInsideViewport, true, `${label}: config editor textarea bottom was clipped by the active tab viewport: ${layout.textareaDetails}`);
  assert.equal(layout.textareaBottomPainted, true, `${label}: config editor textarea bottom border was not actually painted: ${layout.textareaDetails}`);
  assert.equal(layout.textareaInternalScroll, true, `${label}: config editor textarea did not scroll internally for large content`);
  assert.equal(layout.textareaOverflowReady, true, `${label}: config editor textarea was not sized for contained internal scrolling`);
}

async function assertContainedScrollableBlocks(cdp: CdpPage, selector: string, label: string): Promise<void> {
  const layout = await cdp.evaluate<{ count: number; contained: boolean; overflowReady: boolean }>(`(() => {
    const rectContains = (parent, child) => {
      if (!(parent instanceof HTMLElement) || !(child instanceof HTMLElement)) return false;
      const parentRect = parent.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();
      const tolerance = 1;
      return childRect.left >= parentRect.left - tolerance && childRect.top >= parentRect.top - tolerance && childRect.right <= parentRect.right + tolerance && childRect.bottom <= parentRect.bottom + tolerance;
    };
    const blocks = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter((block) => block instanceof HTMLElement);
    return {
      count: blocks.length,
      contained: blocks.every((block) => rectContains(block.parentElement, block)),
      overflowReady: blocks.every((block) => {
        const style = window.getComputedStyle(block);
        return style.overflowX !== 'visible' && style.overflowY !== 'visible' && style.minWidth === '0px' && style.maxWidth === '100%';
      }),
    };
  })()`);
  assert.equal(layout.count > 0, true, `${label} blocks were not rendered`);
  assert.equal(layout.contained, true, `${label} block visibly overflowed its card`);
  assert.equal(layout.overflowReady, true, `${label} block was not configured for internal scrolling`);
}

async function assertNoFixtureRootInUiRequests(cdp: CdpPage): Promise<void> {
  const requests = await cdp.recordedFetchBodies();
  const bodies = requests.map((request) => request.body).filter((body): body is string => body !== undefined);
  assert.equal(bodies.some((body) => body.includes('fixturesRoot')), false, 'production GUI sent fixturesRoot in a normal UI request');
}

async function firstRecordedFetchUrl(cdp: CdpPage, urlPrefix: string): Promise<string> {
  const requests = (await cdp.recordedFetchBodies()).filter((request) => request.url.startsWith(urlPrefix));
  assert.equal(requests.length > 0, true, `No UI request recorded for ${urlPrefix}`);
  return requests[0]?.url ?? '';
}

async function lastRecordedJsonBody(cdp: CdpPage, url: string): Promise<Record<string, unknown>> {
  const requests = (await cdp.recordedFetchBodies()).filter((request) => request.url === url);
  assert.equal(requests.length > 0, true, `No UI request recorded for ${url}`);
  const body = requests.at(-1)?.body;
  assert.equal(body !== undefined, true, `UI request for ${url} did not include a JSON body`);
  return JSON.parse(body ?? '{}') as Record<string, unknown>;
}

function assertCodexNoticePayload(notices: CodexNotice[] | undefined, label: string): void {
  assert.deepEqual(
    notices?.map((notice) => [notice.field, notice.code]),
    [
      ['contextWindow', 'unsupported-native-mapping'],
      ['contextTokens', 'unsupported-native-mapping'],
      ['maxTokens', 'unsupported-native-mapping'],
    ],
    label,
  );
  for (const field of ['contextWindow', 'contextTokens', 'maxTokens']) {
    assert.equal(notices?.some((notice) => notice.field === field && notice.message.includes(field)), true, `${label} missing ${field} message`);
  }
}

function assertNoGitHubToken(text: string, label: string): void {
  assert.equal(text.includes(GITHUB_TOKEN), false, `${label} exposed the GitHub Token`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function codexNativeToml(): string {
  return [
    'model = "gpt-4.1-mini"',
    'model_provider = "openai"',
    '',
    '[model_providers.openai]',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "AGENTCFG_OPENAI_API_KEY"',
    '',
  ].join('\n');
}

function opencodeNativeJson(apiKey: string): string {
  return `${JSON.stringify(
    {
      model: 'openai/gpt-3.5-turbo',
      provider: {
        openai: {
          options: {
            baseURL: 'https://old.example.test/v1',
            apiKey,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function openclawNativeJson(apiKey: string): string {
  return `${JSON.stringify(
    {
      agents: {
        defaults: {
          model: {
            primary: 'openai/gpt-3.5-turbo',
          },
        },
      },
      models: {
        providers: {
          openai: {
            baseUrl: 'https://old.example.test/v1',
            apiKey,
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function claudeNativeJson(apiKey: string): string {
  return `${JSON.stringify(
    {
      theme: 'dark',
      model: 'gpt-3.5-turbo',
      env: {
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_BASE_URL: 'https://old.example.test/v1',
      },
    },
    null,
    2,
  )}\n`;
}
