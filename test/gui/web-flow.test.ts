import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { startWebServer } from '../../src/server';
import { buildGistBody, startFakeGistServer } from '../helpers/fake-gist';

const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CACHED_SECRET = ['gui', 'cached', 'secret'].join('-');
const NATIVE_SECRET = ['gui', 'native', 'secret'].join('-');
const GITHUB_TOKEN = 'gui-github-token';
const SAVED_GITHUB_TOKEN_MASK = '************';
const VALID_AGENTCFG_YAML = [
  'schemaVersion: 1',
  'provider: openai',
  'model: gpt-4.1-mini',
  'baseURL: https://api.openai.com/v1',
  'apiKey:',
  '  type: plain',
  `  value: ${CACHED_SECRET}`,
  '',
].join('\n');

test('web GUI completes init pull diff dry-run preview and confirmed apply', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-gui-flow-'));
  const statePath = join(directory, 'state.json');
  const nativePath = join(directory, 'opencode.jsonc');
  const browserProfile = join(directory, 'chrome-profile');
  const lastStatePathFile = join(directory, 'last-state-path.json');
  const chromePort = await getFreePort();
  const fakeGist = await startFakeGistServer([
    { status: 200, body: [] },
    { status: 201, etag: 'W/"gui-create-etag"', body: { id: 'gui-gist-id', ...buildGistBody('', 'gui-created-revision') } },
    { status: 200, etag: 'W/"gui-load-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-load-revision') },
    { status: 200, etag: 'W/"gui-reload-load-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-reload-load-revision') },
    { status: 200, etag: 'W/"gui-port-change-load-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-port-change-load-revision') },
    { status: 200, etag: 'W/"gui-pull-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-revision') },
  ]);
  const webServer = await startWebServer({
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
  const chrome = launchChrome(chromePort, browserProfile);
  let restartedWebServer: { close(): Promise<void>; url: string } | undefined;

  try {
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));
    const cdp = await openCdpPage(chromePort, webServer.url);

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
      await assertSelectorVisible(cdp, '#remote-provider');
      await assertSelectorVisible(cdp, '#remote-model');
      await assertSelectorVisible(cdp, '#remote-base-url');
      await assertSelectorVisible(cdp, '#remote-api-key');
      await assertSelectorVisible(cdp, '#remote-yaml-preview');
      await assertSelectorVisible(cdp, '#remote-schema-preview');
      await assertRemotePreviewLayout(cdp);
      assert.match(await cdp.textContent('#remote-yaml-preview'), /agentcfg.yaml|schemaVersion/);
      const initialSchemaDocs = await cdp.textContent('#remote-schema-preview');
      assert.match(initialSchemaDocs, /schemaVersion/);
      assert.match(initialSchemaDocs, /apiKey\.type/);
      assert.match(initialSchemaDocs, /apiKey\.value/);
      assert.match(initialSchemaDocs, /plain/);
      assert.match(initialSchemaDocs, /plaintext provider API key stored in agentcfg\.yaml and written verbatim to target agent configs/);
      assert.equal(initialSchemaDocs.includes('当前 plain'), false, 'schema docs repeated the current apiKey.type value');
      await cdp.setInputValue('#remote-provider', 'openai');
      await cdp.setInputValue('#remote-model', 'gpt-4.1-mini');
      await cdp.setInputValue('#remote-base-url', 'https://api.openai.com/v1');
      await cdp.setInputValue('#remote-api-key', CACHED_SECRET);
      const yamlPreviewWithSecretInput = await cdp.textContent('#remote-yaml-preview');
      assert.equal(yamlPreviewWithSecretInput.includes(CACHED_SECRET), true, 'raw YAML preview did not show the edited API key');
      const schemaDocsWithSecretInput = await cdp.textContent('#remote-schema-preview');
      assert.equal(schemaDocsWithSecretInput.includes(CACHED_SECRET), false, 'schema docs exposed the edited provider API key');
      assert.doesNotMatch(schemaDocsWithSecretInput, /当前/);
      await cdp.clickButton('保存远端配置');
      await cdp.waitForText('远端配置已保存');
      assert.equal(await cdp.inputValue('#remote-api-key'), CACHED_SECRET, 'API key input did not show the saved value after save');
      assert.equal((await cdp.bodyText()).includes(CACHED_SECRET), true, 'post-save DOM did not show provider API key');
      await assertDomHasNoGitHubToken(cdp, 'post-remote-save DOM');

      const secretsAfterSave = await readFile(join(directory, 'secrets.json'), 'utf8');
      assert.equal(secretsAfterSave.includes(GITHUB_TOKEN), true, 'remembered GitHub Token was not written to local secrets.json');
      await assertBrowserStorageHasNoSecretsOrStatePath(cdp, statePath, 'post-save browser storage');
      await cdp.clickButton('连接状态');
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
      assert.equal((await cdp.bodyText()).includes(CACHED_SECRET), true, 'post-load DOM did not show provider API key');
      await assertDomHasNoGitHubToken(cdp, 'post-remote-load DOM');
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
      await cdp.installFetchRecorder();
      await cdp.clickButton('远端配置');
      await cdp.clickButton('加载远端配置');
      await cdp.waitForText('远端配置已加载');
      assert.equal(await cdp.inputValue('#remote-api-key'), CACHED_SECRET, 'API key input did not show the loaded value after reload and load');
      await assertDomHasNoGitHubToken(cdp, 'post-reload-remote-load DOM');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/remote/load'), { statePath });

      restartedWebServer = await startWebServer({
        host: '127.0.0.1',
        port: 0,
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
      await cdp.clickButton('加载远端配置');
      await cdp.waitForText('远端配置已加载');
      assert.equal(await cdp.inputValue('#remote-api-key'), CACHED_SECRET, 'API key input did not show the loaded value after port-change navigation');
      await assertDomHasNoGitHubToken(cdp, 'post-port-change-remote-load DOM');
      assert.deepEqual(await lastRecordedJsonBody(cdp, '/api/remote/load'), { statePath });

      const stateAfterSave = await readFile(statePath, 'utf8');
      assert.equal(stateAfterSave.includes(GITHUB_TOKEN), false);
      assert.equal(JSON.parse(stateAfterSave).gist.id, 'gui-gist-id');

      await cdp.clickButton('拉取远端');
      await cdp.waitForText('已拉取远端配置');
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

      await cdp.clickButton('连接状态');
      await cdp.clickButton('清除保存的 Token');
      await cdp.waitForText('已清除本地 Token');
      await assertGitHubTokenEditable(cdp, 'cleared GitHub Token input');
      await assertDomHasNoGitHubToken(cdp, 'post-token-clear DOM');

      const stateApi = await requestText(webServer.url, `/api/state?statePath=${encodeURIComponent(statePath)}`);
      assert.equal(stateApi.includes(CACHED_SECRET), true, 'state API response did not include provider API key');
      assertNoGitHubToken(stateApi, 'state API response');

      await cdp.clickButton('配置文件');
      await cdp.clickSelector('input[name="config-target-mode"][value="opencode"]');
      await assertConfigEditorLayout(cdp);
      await cdp.setInputValue('#config-path-editor', nativePath);
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
      await cdp.clickButton('执行变更');
      await cdp.clickButton('运行 diff');
      await cdp.waitForText('Diff 已就绪');
      await cdp.waitForText(CACHED_SECRET);
      await cdp.waitForText('gui-editor-secret');
      await assertDomHasNoGitHubToken(cdp, 'post-diff DOM');

      await cdp.clickButton('执行 dry-run');
      await cdp.waitForText('Dry-run 完成');
      await cdp.waitForText('当前内容');
      await cdp.waitForText('应用后内容');
      await assertSelectorVisible(cdp, '.file-diff-editor');
      await assertContainedScrollableBlocks(cdp, '.file-diff-editor', 'dry-run file diff editor');
      const dryRunDom = await cdp.bodyText();
      assert.equal(dryRunDom.includes('gui-editor-secret'), true, 'dry-run preview did not show current config content');
      assert.equal(dryRunDom.includes(CACHED_SECRET), true, 'dry-run preview did not show expected config content');
      assert.equal(await cdp.isButtonDisabled('应用所选目标'), true);

      const planApi = await postJsonText(webServer.url, '/api/apply/plan', { statePath, agent: 'opencode', configPath: nativePath });
      assert.equal(planApi.includes('gui-editor-secret'), true, 'dry-run API response did not include current config content');
      assert.equal(planApi.includes(CACHED_SECRET), true, 'dry-run API response did not include expected config content');

      await cdp.setInputValue('#apply-confirmation', 'APPLY');
      await cdp.clickButton('配置文件');
      await cdp.setTextareaValue('#config-editor', opencodeNativeJson('gui-editor-after-plan-secret'));
      await cdp.clickButton('保存配置');
      await cdp.waitForText('配置已保存');
      await cdp.clickButton('执行变更');
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
      await assertNoFixtureRootInUiRequests(cdp);
    } finally {
      await cdp.close();
    }
  } finally {
    chrome.kill('SIGTERM');
    await waitForProcessExit(chrome);
    await restartedWebServer?.close();
    await webServer.close();
    await fakeGist.close();
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

function launchChrome(port: number, userDataDir: string): ChildProcessWithoutNullStreams {
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
  ]);
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
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.ok, true);
  return response.text();
}

async function postJsonText(baseUrl: string, path: string, body: Record<string, unknown>): Promise<string> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
  const preview = await cdp.evaluate<{ yamlHeight: number; schemaHeight: number; contained: boolean; overflowReady: boolean; details: string[] }>(`(() => {
    const rectContains = (parent, child) => {
      if (!(parent instanceof HTMLElement) || !(child instanceof HTMLElement)) return false;
      const parentRect = parent.getBoundingClientRect();
      const childRect = child.getBoundingClientRect();
      const tolerance = 1;
      return childRect.left >= parentRect.left - tolerance && childRect.top >= parentRect.top - tolerance && childRect.right <= parentRect.right + tolerance && childRect.bottom <= parentRect.bottom + tolerance;
    };
    const yaml = document.querySelector('#remote-yaml-preview');
    const schema = document.querySelector('#remote-schema-preview');
    const blocks = [yaml, schema].filter((block) => block instanceof HTMLElement);
    return {
      yamlHeight: yaml instanceof HTMLElement ? yaml.getBoundingClientRect().height : 0,
      schemaHeight: schema instanceof HTMLElement ? schema.getBoundingClientRect().height : 0,
      contained: blocks.every((block) => rectContains(block.parentElement, block)),
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
  assert.equal(preview.contained, true, `remote preview block visibly overflowed its card: ${preview.details.join(', ')}`);
  assert.equal(preview.overflowReady, true, 'remote preview block was not configured for internal scrolling');
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

function assertNoGitHubToken(text: string, label: string): void {
  assert.equal(text.includes(GITHUB_TOKEN), false, `${label} exposed the GitHub Token`);
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
