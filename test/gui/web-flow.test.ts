import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const TASK5_GITHUB_TOKEN = ['task5', 'github', 'token'].join('-');
const TASK5_API_KEY = ['sk', 'test', '1234567890abcdef'].join('-');
const TASK5_EDITED_API_KEY = ['sk', 'test', 'edited', 'abcdef123456'].join('-');
const SAVED_GITHUB_TOKEN_MASK = '************';
const VALID_AGENTCFG_YAML = [
  'schemaVersion: 1',
  'defaults:',
  '  provider: openai',
  '  model: gpt-4.1-mini',
  'providers:',
  '  openai:',
  '    protocol: openai-compatible',
  '    baseURL: https://api.openai.com/v1',
  '    apiKey:',
  '      type: plain',
  `      value: ${CACHED_SECRET}`,
  '    modelDiscovery:',
  '      path: /models',
  '    models:',
  '      gpt-4.1-mini:',
  '        variant: chat',
  '        supportsVision: true',
  '        contextWindow: 1047576',
  '        contextTokens: 1040000',
  '        maxTokens: 32768',
  '',
].join('\n');

const TASK5_AGENTCFG_YAML = [
  'schemaVersion: 1',
  'defaults:',
  '  provider: openai',
  '  model: gpt-4.1-mini',
  'providers:',
  '  openai:',
  '    protocol: openai-compatible',
  '    baseURL: https://api.openai.com/v1',
  '    apiKey:',
  '      type: plain',
  `      value: ${TASK5_API_KEY}`,
  '    models:',
  '      gpt-4.1-mini:',
  '        variant: chat',
  '        supportsVision: true',
  '        contextWindow: 1047576',
  '        contextTokens: 1040000',
  '        maxTokens: 32768',
  '',
].join('\n');

test('web GUI selecting a sync target stays mounted without React/zustand snapshot loop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-target-regression-'));
  const statePath = join(directory, 'state.json');
  const browserProfile = join(directory, 'chrome-profile');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;

  try {
    process.env.HOME = directory;
    const { startWebServer } = await import('../../src/server');
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: { ...process.env, GITHUB_TOKEN: '' },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.installRuntimeErrorRecorder();
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForText('Agent 配置同步中心', 15000);

      assert.equal(await cdp.clickButton('同步'), true, 'sync tab was not clickable');
      await cdp.waitForText('请选择一个目标');
      assert.equal(await cdp.clickSelector('input[name="target-mode"][value="opencode"]'), true, 'OpenCode target was not clickable');
      await cdp.waitForFunction(`(() => {
        const target = document.querySelector('input[name="target-mode"][value="opencode"]');
        const reviewPanel = document.querySelector('#review-panel');
        return target instanceof HTMLInputElement && target.checked && reviewPanel instanceof HTMLElement;
      })()`);
      await delay(250);

      const health = await cdp.evaluate<{ appMounted: boolean; reviewPanelMounted: boolean; bodyTextLength: number }>(`(() => ({
        appMounted: document.querySelector('.command-shell') !== null,
        reviewPanelMounted: document.querySelector('#review-panel') !== null,
        bodyTextLength: document.body?.innerText.trim().length ?? 0,
      }))()`);
      const runtimeErrors = await cdp.runtimeErrors();
      const targetClickLoopErrors = runtimeErrors.filter((message) => /React error #185|Minified React error #185|getSnapshot should be cached|Maximum update depth|Too many re-renders/i.test(message));

      assert.deepEqual(targetClickLoopErrors, []);
      assert.equal(health.appMounted, true, 'target click unmounted the app shell');
      assert.equal(health.reviewPanelMounted, true, 'target click blanked the sync review panel');
      assert.equal(health.bodyTextLength > 0, true, 'target click left a blank UI');
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
    await webServer?.close();
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('Task 7 shell uses redesigned nav and removes permanent right status rail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-shell-redesign-'));
  const statePath = join(directory, 'state.json');
  const browserProfile = join(directory, 'chrome-profile');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;

  try {
    process.env.HOME = directory;
    const { startWebServer } = await import('../../src/server');
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: { ...process.env, GITHUB_TOKEN: '' },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForText('Agent 配置同步中心', 15000);

      const shell = await cdp.evaluate<{
        navLabels: string[];
        commandRailVisible: boolean;
        statusTriggerVisible: boolean;
        mainWidth: number;
        contentWidth: number;
      }>(`(() => {
        const navLabels = Array.from(document.querySelectorAll('.command-nav__item')).map((item) => item.textContent?.trim() ?? '');
        const rail = document.querySelector('.command-rail');
        const commandRailVisible = rail instanceof HTMLElement && window.getComputedStyle(rail).display !== 'none' && window.getComputedStyle(rail).visibility !== 'hidden';
        const statusTrigger = document.querySelector('.command-status-trigger > summary');
        const main = document.querySelector('.command-main');
        const content = document.querySelector('.command-content');
        return {
          navLabels,
          commandRailVisible,
          statusTriggerVisible: statusTrigger instanceof HTMLElement && statusTrigger.textContent?.includes('状态') === true,
          mainWidth: main instanceof HTMLElement ? main.getBoundingClientRect().width : 0,
          contentWidth: content instanceof HTMLElement ? content.getBoundingClientRect().width : 0,
        };
      })()`);

      assert.deepEqual(shell.navLabels, ['首页', '配置', '同步', '规则与 Skills', '设置']);
      assert.equal(shell.commandRailVisible, false, 'Task 7 shell should not render a permanently visible .command-rail');
      assert.equal(shell.statusTriggerVisible, true, 'Task 7 shell should expose a compact status trigger');
      assert.equal(shell.mainWidth > 0, true, 'Task 7 shell main workspace was not measurable');
      assert.equal(shell.mainWidth >= shell.contentWidth - 2, true, 'Task 7 shell main workspace did not reclaim the former right-rail width');
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
    await webServer?.close();
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('Task 5 security keeps saved GitHub Token masked and allows intentional quick API key copy/edit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-security-'));
  const statePath = join(directory, 'state.json');
  const browserProfile = join(directory, 'chrome-profile');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let fakeGist: Awaited<ReturnType<typeof startFakeGistServer>> | undefined;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;

  try {
    process.env.HOME = directory;
    await writeTask5SecurityState(statePath);
    await writeFile(join(directory, 'secrets.json'), `${JSON.stringify({ githubToken: TASK5_GITHUB_TOKEN }, null, 2)}\n`);
    const { startWebServer } = await import('../../src/server');
    fakeGist = await startFakeGistServer({
      status: 200,
      etag: 'W/"task5-load-etag"',
      body: buildGistBody(TASK5_AGENTCFG_YAML, 'task5-load-revision'),
    });
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: {
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: fakeGist.apiBaseUrl,
        GITHUB_TOKEN: '',
      },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.installRuntimeErrorRecorder();
      await cdp.installClipboardRecorder();
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForText('工作台', 15000);
      await cdp.clickSelector('#remote-tab');
      await cdp.waitForText('GitHub Token 已以明文保存到本机 secrets.json');
      await cdp.waitForText('远端配置已自动刷新');
      await assertSavedGitHubTokenLocked(cdp, 'Task 5 saved GitHub Token input');
      await assertDomValuesDoNotContain(cdp, TASK5_GITHUB_TOKEN, 'Task 5 saved GitHub Token DOM values');

      await assertSelectorVisible(cdp, '#defaults-quick-api-key');
      const maskedApiKey = await cdp.inputValue('#defaults-quick-api-key');
      assert.equal(maskedApiKey, maskTask5QuickApiKey(TASK5_API_KEY));
      assert.equal(maskedApiKey.includes(TASK5_API_KEY), false, 'Task 5 quick API key default display exposed the full key');

      assert.equal(await cdp.clickSelector('.api-key-copy-button'), true, 'Task 5 quick API key copy button was not clickable');
      assert.deepEqual(await cdp.clipboardWrites(), [TASK5_API_KEY]);
      assert.deepEqual(await cdp.runtimeErrors(), []);

      assert.equal(await cdp.focusSelector('#defaults-quick-api-key'), true, 'Task 5 quick API key input was not focusable');
      await cdp.waitForFunction(`document.querySelector('#defaults-quick-api-key') instanceof HTMLInputElement && document.querySelector('#defaults-quick-api-key').value === ${JSON.stringify(TASK5_API_KEY)}`);
      assert.equal(await cdp.setInputValue('#defaults-quick-api-key', TASK5_EDITED_API_KEY), true, 'Task 5 quick API key input did not accept edits');
      assert.equal(await cdp.inputValue('#defaults-quick-api-key'), TASK5_EDITED_API_KEY);
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
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

test('Task 5 RED contract masks cached API key in dashboard and status surfaces by default', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-security-red-'));
  const statePath = join(directory, 'state.json');
  const browserProfile = join(directory, 'chrome-profile');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;

  try {
    process.env.HOME = directory;
    await writeTask5SecurityState(statePath);
    const { startWebServer } = await import('../../src/server');
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: { ...process.env, GITHUB_TOKEN: '' },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForText('工作台', 15000);

      const highLevelSurfaces = await cdp.evaluate<{ overviewText: string; statusRailText: string; statusDetailsText: string }>(`(() => ({
        overviewText: document.querySelector('#overview-panel')?.textContent ?? '',
        statusRailText: document.querySelector('.status-rail')?.textContent ?? '',
        statusDetailsText: document.querySelector('#status-details')?.textContent ?? '',
      }))()`);
      assert.equal(
        highLevelSurfaces.overviewText.includes(TASK5_API_KEY),
        false,
        'Task 5 RED contract: Home/dashboard surface must not show the full cached API key by default',
      );
      assert.equal(
        highLevelSurfaces.statusRailText.includes(TASK5_API_KEY),
        false,
        'Task 5 RED contract: Status/debug rail must mask cached provider API keys by default',
      );
      assert.equal(
        highLevelSurfaces.statusDetailsText.includes(TASK5_API_KEY),
        false,
        'Task 5 RED contract: Collapsed status details must not keep full provider API keys in default text content',
      );
      assert.equal(
        highLevelSurfaces.statusRailText.includes(maskTask5QuickApiKey(TASK5_API_KEY)) || highLevelSurfaces.statusRailText.includes('***MASKED***'),
        true,
        'Task 5 RED contract: Status/debug surface should show a masked API key affordance instead of removing the field',
      );
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
    await webServer?.close();
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('Task 20 first-run invalid GitHub Token explains cause and next action', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-task20-invalid-token-'));
  const statePath = join(directory, 'state.json');
  const browserProfile = join(directory, 'chrome-profile');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let fakeGist: Awaited<ReturnType<typeof startFakeGistServer>> | undefined;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;

  try {
    process.env.HOME = directory;
    fakeGist = await startFakeGistServer({
      status: 401,
      body: { message: 'Bad credentials' },
    });
    const { startWebServer } = await import('../../src/server');
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: {
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: fakeGist.apiBaseUrl,
        GITHUB_TOKEN: '',
      },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.installRuntimeErrorRecorder();
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForText('Agent 配置同步中心', 15000);
      assert.equal(await cdp.clickButton('开始设置'), true, 'Task 20 first-run CTA did not navigate to Configuration');
      await cdp.waitForFunction('document.querySelector("#connection-panel") !== null');

      await cdp.setInputValue('#github-token', 'invalid-github-token');
      await cdp.clickSelector('.setup-form__advanced > summary');
      await cdp.waitForFunction('document.querySelector(".setup-form__advanced") instanceof HTMLDetailsElement && document.querySelector(".setup-form__advanced")?.open === true');
      await cdp.setInputValue('#state-path', statePath);
      await cdp.submitForm('.setup-form');

      await cdp.waitForText('Token 配置失败');
      await cdp.waitForText('GitHub Gist list failed with 401 Unauthorized');
      await cdp.waitForText('下一步：确认 GitHub Token 仍有效并包含 gist 权限');
      assert.deepEqual(await cdp.runtimeErrors(), []);
      assert.equal(fakeGist.requests[0]?.authorization, 'Bearer invalid-github-token');
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
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

test('Task 18 first-run flow connects, configures, previews, and applies from redesigned Home', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-task18-first-run-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');
  const browserProfile = join(directory, 'chrome-profile');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let fakeGist: Awaited<ReturnType<typeof startFakeGistServer>> | undefined;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;

  try {
    process.env.HOME = directory;
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));
    fakeGist = await startFakeGistServer([
      { status: 200, body: [] },
      { status: 201, etag: 'W/"task18-create-etag"', body: { id: 'task18-gist-id', ...buildGistBody('', 'task18-created-revision') } },
      { status: 200, etag: 'W/"task18-save-etag"', body: { id: 'task18-gist-id', ...buildGistBody(VALID_AGENTCFG_YAML, 'task18-save-revision') } },
      { status: 200, etag: 'W/"task18-load-etag"', body: { id: 'task18-gist-id', ...buildGistBody(VALID_AGENTCFG_YAML, 'task18-load-revision') } },
    ]);
    const { startWebServer } = await import('../../src/server');
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: {
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: fakeGist.apiBaseUrl,
        GITHUB_TOKEN: '',
      },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.installFetchRecorder();
      await cdp.installRuntimeErrorRecorder();
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForText('Agent 配置同步中心', 15000);
      await cdp.waitForText('用一个私有 Gist 集中维护 Skills、规则文件和 Provider / Model 目录');
      assert.equal(await cdp.clickButton('开始设置'), true, 'first-run Home CTA did not navigate to Configuration');
      await cdp.waitForFunction('document.querySelector("#connection-panel") !== null');

      await cdp.setInputValue('#github-token', GITHUB_TOKEN);
      await cdp.clickSelector('.setup-form__advanced > summary');
      await cdp.waitForFunction('document.querySelector(".setup-form__advanced") instanceof HTMLDetailsElement && document.querySelector(".setup-form__advanced")?.open === true');
      await cdp.setInputValue('#state-path', statePath);
      await cdp.clickSelector('#remember-github-token');
      await cdp.submitForm('.setup-form');
      await cdp.waitForText('准备创建远端配置');
      await assertDomValuesDoNotContain(cdp, GITHUB_TOKEN, 'Task 18 first-run post-connect DOM values');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/remote/setup'), {
        statePath,
        githubToken: GITHUB_TOKEN,
        rememberGitHubToken: true,
      });

      await cdp.clickSelector('.remote-source-panel__advanced > summary');
      await cdp.waitForFunction('document.querySelector(".remote-source-panel__advanced") instanceof HTMLDetailsElement && document.querySelector(".remote-source-panel__advanced")?.open === true');
      await assertRemoteEditorMode(cdp);
      await cdp.setInputValue('#remote-provider', 'openai');
      await cdp.selectValue('#remote-provider-protocol', 'openai-compatible');
      await cdp.setInputValue('#remote-base-url', 'https://api.openai.com/v1');
      await cdp.setInputValue('#remote-api-key', CACHED_SECRET);
      await cdp.setInputValue('#remote-model', 'gpt-4.1-mini');
      await cdp.setInputValue('#remote-model-variant', 'chat');
      await cdp.clickSelector('#remote-model-supports-vision');
      await cdp.setInputValue('#remote-model-context-window', '1047576');
      await cdp.setInputValue('#remote-model-context-tokens', '1040000');
      await cdp.setInputValue('#remote-model-max-tokens', '32768');
      await cdp.selectValue('#remote-default-provider', 'openai');
      await cdp.selectValue('#remote-default-model', 'gpt-4.1-mini');
      await cdp.clickButton('保存配置');
      await cdp.waitForText('远端配置已保存');
      const savePayload = await lastRecordedJsonBody(cdp, '/api/configuration/save');
      assert.equal((savePayload.config as { providers: { openai: { protocol?: string; models: { 'gpt-4.1-mini': { supportsVision?: boolean } } } } }).providers.openai.protocol, 'openai-compatible');
      assert.equal((savePayload.config as { providers: { openai: { models: { 'gpt-4.1-mini': { supportsVision?: boolean } } } } }).providers.openai.models['gpt-4.1-mini'].supportsVision, true);
      await assertDomValuesDoNotContain(cdp, GITHUB_TOKEN, 'Task 18 first-run post-save DOM values');
      await assertBrowserStorageHasNoSecretsOrStatePath(cdp, statePath, 'Task 18 first-run browser storage');

      await cdp.clickSelector('#sync-tab');
      await cdp.waitForText('请选择一个目标');
      await cdp.clickSelector('input[name="target-mode"][value="opencode"]');
      await cdp.setInputValue('#config-path', nativePath);
      await cdp.waitForText('中央目录映射');
      await cdp.waitForText('openai / gpt-4.1-mini (openai-compatible)');
      assert.equal(await cdp.isButtonDisabledInPanel('#review-panel', '应用变更'), true, 'Task 18 first-run apply unlocked before preview');
      assert.equal(await cdp.clickButtonInPanel('#review-panel', '预览 (Dry-run)'), true, 'Task 18 first-run preview button was not clickable');
      await cdp.waitForText('预览完成');
      await assertSelectorVisible(cdp, '.file-diff-editor');
      assert.equal(await cdp.isButtonDisabledInPanel('#review-panel', '应用变更'), true, 'Task 18 first-run apply unlocked before checkbox confirmation');
      await cdp.clickSelector('#apply-confirmation');
      await cdp.waitForFunction(`(() => {
        const button = Array.from(document.querySelectorAll('#review-panel button')).find((candidate) => candidate.textContent?.includes('应用变更'));
        return button instanceof HTMLButtonElement && !button.disabled;
      })()`);
      assert.equal(await cdp.clickButtonInPanel('#review-panel', '应用变更'), true, 'Task 18 first-run apply button was not clickable after confirmation');
      await cdp.waitForText('应用完成');
      assert.equal((await readFile(nativePath, 'utf8')).includes(CACHED_SECRET), true, 'Task 18 first-run apply did not write the configured provider API key');
      await assertDomValuesDoNotContain(cdp, GITHUB_TOKEN, 'Task 18 first-run post-apply DOM values');
      assert.deepEqual(
        (await cdp.runtimeErrors()).filter((message) => /React error #185|Minified React error #185|getSnapshot should be cached|Maximum update depth|Too many re-renders/i.test(message)),
        [],
      );
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
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

test('Task 18 returning-user flow covers Home, Configuration protocol fields, and Sync checkbox apply gate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-task18-returning-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');
  const browserProfile = join(directory, 'chrome-profile');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let fakeGist: Awaited<ReturnType<typeof startFakeGistServer>> | undefined;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;

  try {
    process.env.HOME = directory;
    await writeTask5SecurityState(statePath);
    await writeFile(join(directory, 'secrets.json'), `${JSON.stringify({ githubToken: GITHUB_TOKEN }, null, 2)}\n`);
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));
    fakeGist = await startFakeGistServer({
      status: 200,
      etag: 'W/"task18-returning-etag"',
      body: { id: 'task5-gist-id', ...buildGistBody(TASK5_AGENTCFG_YAML, 'task18-returning-revision') },
    });
    const { startWebServer } = await import('../../src/server');
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: {
        ...process.env,
        AGENTCFG_GIST_API_BASE_URL: fakeGist.apiBaseUrl,
        GITHUB_TOKEN: '',
      },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.installFetchRecorder();
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForText('工作台', 15000);
      await cdp.waitForText('openai / gpt-4.1-mini');
      await cdp.waitForText('进入同步');
      const homeText = await cdp.textContent('#overview-panel');
      assert.equal(homeText.includes(TASK5_API_KEY), false, 'Task 18 returning Home exposed the full provider API key');

      await cdp.clickSelector('#remote-tab');
      await cdp.waitForText('GitHub Token');
      await cdp.clickSelector('.remote-source-panel__advanced > summary');
      await cdp.waitForFunction('document.querySelector(".remote-source-panel__advanced") instanceof HTMLDetailsElement && document.querySelector(".remote-source-panel__advanced")?.open === true');
      await cdp.clickSelector('.remote-command-advanced > summary');
      await cdp.waitForFunction('document.querySelector(".remote-command-advanced") instanceof HTMLDetailsElement && document.querySelector(".remote-command-advanced")?.open === true');
      assert.equal(await cdp.clickButtonInPanel('#remote-panel', '读取远端'), true, 'Task 18 returning load remote button was not clickable');
      await cdp.waitForText('远端配置已加载');
      assert.equal(await cdp.inputValue('#defaults-quick-api-key'), maskTask5QuickApiKey(TASK5_API_KEY));
      await assertSelectorVisible(cdp, '#remote-provider-protocol');
      assert.equal(await cdp.selectValue('#remote-provider-protocol', 'openai-compatible'), true, 'Task 18 returning protocol select was not editable');
      assert.equal(await cdp.evaluate<string>('document.querySelector("#remote-provider-protocol") instanceof HTMLSelectElement ? document.querySelector("#remote-provider-protocol").value : ""'), 'openai-compatible');
      const supportsVisionChecked = await cdp.evaluate<boolean>('document.querySelector("#remote-model-supports-vision") instanceof HTMLInputElement && document.querySelector("#remote-model-supports-vision").checked');
      if (!supportsVisionChecked) {
        await cdp.clickSelector('#remote-model-supports-vision');
      }
      assert.equal(await cdp.evaluate<boolean>('document.querySelector("#remote-model-supports-vision") instanceof HTMLInputElement && document.querySelector("#remote-model-supports-vision").checked'), true);

      await cdp.clickSelector('#sync-tab');
      await cdp.waitForText('请选择一个目标');
      await cdp.clickSelector('input[name="target-mode"][value="opencode"]');
      await cdp.setInputValue('#config-path', nativePath);
      await cdp.waitForText('中央目录映射');
      await cdp.waitForText('openai / gpt-4.1-mini (openai-compatible)');
      assert.equal(await cdp.isButtonDisabledInPanel('#review-panel', '应用变更'), true, 'Task 18 returning apply unlocked before preview');
      assert.equal(await cdp.clickButtonInPanel('#review-panel', '预览 (Dry-run)'), true, 'Task 18 returning preview button was not clickable');
      await cdp.waitForText('预览完成');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/apply/plan'), { statePath, agent: 'opencode', configPath: nativePath });
      assert.equal(await cdp.inputDisabled('#apply-confirmation'), false, 'Task 18 returning confirmation checkbox stayed disabled after preview');
      assert.equal(await cdp.isButtonDisabledInPanel('#review-panel', '应用变更'), true, 'Task 18 returning apply unlocked before checkbox');
      await cdp.clickSelector('#apply-confirmation');
      await cdp.waitForFunction(`(() => {
        const button = Array.from(document.querySelectorAll('#review-panel button')).find((candidate) => candidate.textContent?.includes('应用变更'));
        return button instanceof HTMLButtonElement && !button.disabled;
      })()`);
      assert.equal(await cdp.clickButtonInPanel('#review-panel', '应用变更'), true, 'Task 18 returning apply button was not clickable after checkbox');
      await cdp.waitForText('应用完成');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/apply'), { statePath, agent: 'opencode', configPath: nativePath, confirm: 'APPLY' });
      assert.equal((await readFile(nativePath, 'utf8')).includes(TASK5_API_KEY), true, 'Task 18 returning apply did not write cached provider API key');
      await assertDomValuesDoNotContain(cdp, GITHUB_TOKEN, 'Task 18 returning DOM values');
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
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

test('Task 18 Settings exposes masked token, automation controls, raw editor expansion, and debug details', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-task18-settings-'));
  const statePath = join(directory, 'state.json');
  const browserProfile = join(directory, 'chrome-profile');
  const chromePort = await getFreePort();
  const previousHome = process.env.HOME;
  let webServer: AgentCfgWebServer | undefined;
  let chrome: ChildProcessWithoutNullStreams | undefined;

  try {
    process.env.HOME = directory;
    await writeTask5SecurityState(statePath);
    await writeFile(join(directory, 'secrets.json'), `${JSON.stringify({ githubToken: GITHUB_TOKEN }, null, 2)}\n`);
    const { startWebServer } = await import('../../src/server');
    webServer = await startWebServer({
      host: '127.0.0.1',
      port: 0,
      statePath,
      assetsDir: resolve(process.cwd(), 'web', 'dist'),
      env: { ...process.env, GITHUB_TOKEN: '' },
    });
    chrome = launchChrome(chromePort, browserProfile, previousHome);
    const cdp = await openCdpPage(chromePort, 'about:blank');

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForText('工作台', 15000);
      await cdp.clickSelector('#automation-tab');
      await cdp.waitForText('连接、自动化与高级诊断集中管理');
      await assertSavedGitHubTokenLocked(cdp, 'Task 18 Settings saved GitHub Token input');
      await assertDomValuesDoNotContain(cdp, GITHUB_TOKEN, 'Task 18 Settings masked GitHub Token DOM values');
      await assertSelectorVisible(cdp, '#auto-sync-enabled');
      await assertSelectorVisible(cdp, '#auto-sync-interval');
      await cdp.waitForText('保存自动同步设置');
      await cdp.waitForText('安装后台服务');

      const rawEditorInitiallyOpen = await cdp.evaluate<boolean>('document.querySelector("#settings-raw-editor") instanceof HTMLDetailsElement && document.querySelector("#settings-raw-editor").open');
      assert.equal(rawEditorInitiallyOpen, false, 'Task 18 Settings raw editor should be collapsed by default');
      await cdp.clickSelector('#settings-raw-editor > summary');
      await cdp.waitForFunction('document.querySelector("#settings-raw-editor") instanceof HTMLDetailsElement && document.querySelector("#settings-raw-editor")?.open === true');
      await assertSelectorVisible(cdp, '#config-path-editor');
      await assertSelectorVisible(cdp, '#config-editor');
      await assertSelectorVisible(cdp, '#config-agent-opencode-tab');

      await assertSelectorVisible(cdp, '#status-details');
      const debugText = await cdp.textContent('#status-details');
      assert.match(debugText, /Revision|ETag|基线|cache|缓存/);
      assert.equal(debugText.includes(GITHUB_TOKEN), false, 'Task 18 Settings debug details exposed the full GitHub Token');
      await assertBrowserStorageHasNoSecretsOrStatePath(cdp, statePath, 'Task 18 Settings browser storage');
    } finally {
      await cdp.close();
    }
  } finally {
    if (chrome !== undefined) {
      chrome.kill('SIGTERM');
      await waitForProcessExit(chrome);
    }
    await webServer?.close();
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

  async installRuntimeErrorRecorder(): Promise<boolean> {
    const source = `(() => {
      if (window.__agentcfgRuntimeErrorRecorderInstalled === true) {
        return true;
      }
      const messages = [];
      const stringify = (value) => {
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      };
      Object.defineProperty(window, '__agentcfgRuntimeErrors', { value: messages, configurable: true });
      Object.defineProperty(window, '__agentcfgRuntimeErrorRecorderInstalled', { value: true, configurable: true });
      window.addEventListener('error', (event) => messages.push(String(event.message ?? '')));
      window.addEventListener('unhandledrejection', (event) => messages.push(stringify(event.reason)));
      const originalConsoleError = console.error.bind(console);
      console.error = (...args) => {
        messages.push(args.map(stringify).join(' '));
        originalConsoleError(...args);
      };
      return true;
    })()`;
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
    return this.evaluate<boolean>(source);
  }

  async installClipboardRecorder(): Promise<boolean> {
    const source = `(() => {
      if (window.__agentcfgClipboardRecorderInstalled === true) {
        return true;
      }
      const writes = [];
      Object.defineProperty(window, '__agentcfgClipboardWrites', { value: writes, configurable: true });
      Object.defineProperty(window, '__agentcfgClipboardRecorderInstalled', { value: true, configurable: true });
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text) => {
            writes.push(String(text));
          },
        },
        configurable: true,
      });
      return true;
    })()`;
    await this.send('Page.addScriptToEvaluateOnNewDocument', { source });
    return this.evaluate<boolean>(source);
  }

  recordedFetchBodies(): Promise<Array<{ url: string; body?: string }>> {
    return this.evaluate<Array<{ url: string; body?: string }>>(`window.__agentcfgFetchBodies ?? []`);
  }

  runtimeErrors(): Promise<string[]> {
    return this.evaluate<string[]>('window.__agentcfgRuntimeErrors ?? []');
  }

  clipboardWrites(): Promise<string[]> {
    return this.evaluate<string[]>('window.__agentcfgClipboardWrites ?? []');
  }

  async waitForFunction(expression: string, timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (await this.evaluate<boolean>(expression)) {
        return;
      }
      await delay(50);
    }
    const bodyText = await this.evaluate<string>('document.body?.innerText.slice(0, 500) ?? ""');
    throw new Error(`Timed out waiting for browser condition: ${expression}; body=${JSON.stringify(bodyText)}`);
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

  focusSelector(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(element instanceof HTMLElement)) return false;
      element.focus();
      element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      return document.activeElement === element;
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

  clickButtonInPanel(panelSelector: string, text: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const panel = document.querySelector(${JSON.stringify(panelSelector)});
      if (!(panel instanceof HTMLElement)) return false;
      const buttons = Array.from(panel.querySelectorAll('button'));
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

  isButtonDisabledInPanel(panelSelector: string, text: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const panel = document.querySelector(${JSON.stringify(panelSelector)});
      if (!(panel instanceof HTMLElement)) return true;
      const buttons = Array.from(panel.querySelectorAll('button'));
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

  buttonDisabled(selector: string): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      return button instanceof HTMLButtonElement && button.disabled;
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

async function assertDomValuesDoNotContain(cdp: CdpPage, secret: string, label: string): Promise<void> {
  const domValues = await cdp.evaluate<string>(`(() => {
    const fieldValues = Array.from(document.querySelectorAll('input, textarea')).map((field) => field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : '');
    return [document.body?.textContent ?? '', ...fieldValues].join(${JSON.stringify('\n')});
  })()`);
  assert.equal(domValues.includes(secret), false, `${label} exposed ${secret}`);
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

async function assertSelectorVisible(cdp: CdpPage, selector: string): Promise<void> {
  assert.equal(await cdp.selectorVisible(selector), true, `${selector} was not visible`);
}

async function assertSelectorNotVisible(cdp: CdpPage, selector: string): Promise<void> {
  assert.equal(await cdp.selectorVisible(selector), false, `${selector} should not be visible`);
}

async function assertRemoteEditorMode(cdp: CdpPage): Promise<void> {
  await assertSelectorVisible(cdp, '#remote-provider');
  await assertSelectorVisible(cdp, '#remote-api-key');
  await assertSelectorNotVisible(cdp, '#remote-yaml-preview');
  await assertSelectorNotVisible(cdp, '#remote-schema-preview');
  const activeEditor = await cdp.evaluate<boolean>(`document.querySelector('#remote-view-editor')?.getAttribute('aria-pressed') === 'true'`);
  assert.equal(activeEditor, true, 'remote config did not default to editor mode');
}

async function lastRecordedJsonBody(cdp: CdpPage, url: string): Promise<Record<string, unknown>> {
  const requests = (await cdp.recordedFetchBodies()).filter((request) => request.url === url);
  assert.equal(requests.length > 0, true, `No UI request recorded for ${url}`);
  const body = requests.at(-1)?.body;
  assert.equal(body !== undefined, true, `UI request for ${url} did not include a JSON body`);
  return JSON.parse(body ?? '{}') as Record<string, unknown>;
}

function assertNoGitHubToken(text: string, label: string): void {
  assert.equal(text.includes(GITHUB_TOKEN), false, `${label} exposed the GitHub Token`);
}

async function writeTask5SecurityState(statePath: string): Promise<void> {
  const config = task5AgentConfig();
  await writeFile(statePath, `${JSON.stringify(
    {
      schemaVersion: 1,
      gist: { id: 'task5-gist-id' },
      remote: {
        revision: 'task5-revision',
        etag: 'W/"task5-etag"',
        pulledAt: '2026-06-22T00:00:00.000Z',
      },
      cache: {
        config,
        updatedAt: '2026-06-22T00:00:00.000Z',
      },
      conflict: {
        baseConfig: config,
        baseRevision: 'task5-revision',
        baseETag: 'W/"task5-etag"',
      },
    },
    null,
    2,
  )}\n`);
}

function task5AgentConfig() {
  return {
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
          value: TASK5_API_KEY,
        },
        models: {
          'gpt-4.1-mini': {
            variant: 'chat',
            supportsVision: true,
            contextWindow: 1047576,
            contextTokens: 1040000,
            maxTokens: 32768,
          },
        },
      },
    },
  };
}

function maskTask5QuickApiKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed.length <= 12) return `${trimmed.slice(0, 3)}••••${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 7)}••••••••••••${trimmed.slice(-6)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
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
