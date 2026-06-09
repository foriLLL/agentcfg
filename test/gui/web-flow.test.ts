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
  const chromePort = await getFreePort();
  const fakeGist = await startFakeGistServer([
    { status: 200, body: [] },
    { status: 201, etag: 'W/"gui-create-etag"', body: { id: 'gui-gist-id', ...buildGistBody('', 'gui-created-revision') } },
    { status: 200, etag: 'W/"gui-load-etag"', body: buildGistBody(VALID_AGENTCFG_YAML, 'gui-load-revision') },
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
      GITHUB_TOKEN: '',
    },
  });
  const chrome = launchChrome(chromePort, browserProfile);

  try {
    await writeFile(nativePath, opencodeNativeJson(NATIVE_SECRET));
    const cdp = await openCdpPage(chromePort, webServer.url);

    try {
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
      await cdp.send('Page.navigate', { url: webServer.url });
      await cdp.waitForFunction('document.body?.innerText.includes("连接状态") === true');
      await cdp.waitForFunction('document.scrollingElement !== null && document.scrollingElement.scrollHeight <= document.scrollingElement.clientHeight');
      await cdp.installFetchRecorder();
      await assertFixtureRootControlHidden(cdp);
      await assertDomHasNoSecrets(cdp, 'initial DOM');

      await cdp.setInputValue('#github-token', GITHUB_TOKEN);
      await cdp.setInputValue('#state-path', statePath);
      await cdp.submitForm('.setup-form');
      await cdp.waitForText('准备创建远端配置');
      await assertDomHasNoSecrets(cdp, 'post-init DOM');

      await cdp.waitForText('远端配置');
      await assertSelectorVisible(cdp, '#remote-provider');
      await assertSelectorVisible(cdp, '#remote-model');
      await assertSelectorVisible(cdp, '#remote-base-url');
      await assertSelectorVisible(cdp, '#remote-api-key');
      await assertSelectorVisible(cdp, '#remote-yaml-preview');
      await assertSelectorVisible(cdp, '#remote-schema-preview');
      assert.match(await cdp.textContent('#remote-yaml-preview'), /agentcfg.yaml|schemaVersion/);
      assert.match(await cdp.textContent('#remote-schema-preview'), /schema\/reference/);
      await cdp.setInputValue('#remote-provider', 'openai');
      await cdp.setInputValue('#remote-model', 'gpt-4.1-mini');
      await cdp.setInputValue('#remote-base-url', 'https://api.openai.com/v1');
      await cdp.setInputValue('#remote-api-key', CACHED_SECRET);
      const yamlPreviewWithSecretInput = await cdp.textContent('#remote-yaml-preview');
      assert.equal(yamlPreviewWithSecretInput.includes(CACHED_SECRET), false, 'raw YAML preview exposed the edited API key');
      assert.equal(yamlPreviewWithSecretInput.includes('已填写，保存时写入'), true);
      await cdp.clickButton('保存远端配置');
      await cdp.waitForText('远端配置已保存');
      assert.equal(await cdp.inputValue('#remote-api-key'), '', 'API key input was not cleared after save');
      await assertDomHasNoSecrets(cdp, 'post-remote-save DOM');

      await cdp.clickButton('加载远端配置');
      await cdp.waitForText('远端配置已加载');
      assert.equal(await cdp.inputValue('#remote-api-key'), '', 'API key input was not cleared after load');
      await assertDomHasNoSecrets(cdp, 'post-remote-load DOM');

      const stateAfterSave = await readFile(statePath, 'utf8');
      assert.equal(stateAfterSave.includes(GITHUB_TOKEN), false);
      assert.equal(JSON.parse(stateAfterSave).gist.id, 'gui-gist-id');

      await cdp.clickButton('拉取远端');
      await cdp.waitForText('已拉取远端配置');
      await cdp.waitForText('API 已隐藏密钥');
      await assertDomHasNoSecrets(cdp, 'post-pull DOM');
      assert.deepEqual(fakeGist.requests.map(({ url, method, authorization }) => ({ url, method, authorization })), [
        { url: '/?per_page=100', method: 'GET', authorization: `Bearer ${GITHUB_TOKEN}` },
        { url: '/', method: 'POST', authorization: `Bearer ${GITHUB_TOKEN}` },
        { url: '/gui-gist-id', method: 'GET', authorization: `Bearer ${GITHUB_TOKEN}` },
        { url: '/gui-gist-id', method: 'GET', authorization: `Bearer ${GITHUB_TOKEN}` },
      ]);

      const stateApi = await requestText(webServer.url, `/api/state?statePath=${encodeURIComponent(statePath)}`);
      assertNoSecrets(stateApi, 'state API response');

      await cdp.clickButton('配置文件');
      await cdp.clickSelector('input[name="config-target-mode"][value="opencode"]');
      await cdp.setInputValue('#config-path-editor', nativePath);
      await cdp.clickButton('加载配置');
      await cdp.waitForText('配置已加载');
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
      await cdp.waitForText('密钥已脱敏');
      await assertDomHasNoSecrets(cdp, 'post-diff DOM');

      await cdp.clickButton('执行 dry-run');
      await cdp.waitForText('Dry-run 完成');
      await cdp.waitForText('当前内容');
      await cdp.waitForText('应用后内容');
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

  installFetchRecorder(): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const originalFetch = window.fetch.bind(window);
      const requests = [];
      Object.defineProperty(window, '__agentcfgFetchBodies', { value: requests, configurable: true });
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const body = typeof init?.body === 'string' ? init.body : undefined;
        requests.push({ url, body });
        return originalFetch(input, init);
      };
      return true;
    })()`);
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
  const deadline = Date.now() + 5000;
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

async function assertDomHasNoSecrets(cdp: CdpPage, label: string): Promise<void> {
  assertNoSecrets(await cdp.bodyText(), label);
}

async function assertSelectorVisible(cdp: CdpPage, selector: string): Promise<void> {
  assert.equal(await cdp.selectorVisible(selector), true, `${selector} was not visible`);
}

async function assertFixtureRootControlHidden(cdp: CdpPage): Promise<void> {
  const fixtureControlPresent = await cdp.evaluate<boolean>(`document.body?.innerText.includes('Fixture root optional') === true || document.querySelector('#fixtures-root') !== null`);
  assert.equal(fixtureControlPresent, false, 'production GUI exposed a fixture root control');
}

async function assertNoFixtureRootInUiRequests(cdp: CdpPage): Promise<void> {
  const requests = await cdp.recordedFetchBodies();
  const bodies = requests.map((request) => request.body).filter((body): body is string => body !== undefined);
  assert.equal(bodies.some((body) => body.includes('fixturesRoot')), false, 'production GUI sent fixturesRoot in a normal UI request');
}

function assertNoSecrets(text: string, label: string): void {
  for (const secret of [CACHED_SECRET, NATIVE_SECRET]) {
    assert.equal(text.includes(secret), false, `${label} exposed a raw secret`);
  }
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
