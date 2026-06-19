import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectRequestStatePath,
  selectShouldRememberGitHubToken,
  useRuntimeStore,
} from '../../../web/src/stores';
import type { RuntimeStateSummary } from '../../../web/src/api';

const INITIAL_RUNTIME_SLOT = useRuntimeStore.getState();

function resetRuntimeStore(): void {
  useRuntimeStore.setState(INITIAL_RUNTIME_SLOT, true);
}

function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response> | Response): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const result = await handler(url, init);
    return result as Response;
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = previous;
  };
}

function envelope<T>(data: T): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const STATE_FIXTURE: RuntimeStateSummary = {
  statePath: '/tmp/agentcfg-state.json',
  schemaVersion: 1,
  gist: { present: true, id: 'gist-123' },
  cache: { present: true, updatedAt: '2026-06-14T00:00:00.000Z' },
  conflict: { present: false },
  secrets: { hasGitHubToken: true },
};

test('runtimeStore.bootstrap commits state and reports auto-load flag when token + gist present', async () => {
  resetRuntimeStore();
  const restore = stubFetch(async (url) => {
    assert.match(url, /\/api\/state/);
    return envelope({ state: STATE_FIXTURE });
  });
  try {
    const outcome = await useRuntimeStore.getState().bootstrap();
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;
    assert.equal(outcome.shouldAutoLoadRemote, true);
    assert.equal(useRuntimeStore.getState().loadState, 'ready');
    assert.equal(useRuntimeStore.getState().state?.gist.id, 'gist-123');
    assert.equal(useRuntimeStore.getState().gistId, 'gist-123');
    assert.equal(useRuntimeStore.getState().statePath, '/tmp/agentcfg-state.json');
  } finally {
    restore();
    resetRuntimeStore();
  }
});

test('runtimeStore.bootstrap reports failure and switches to error loadState', async () => {
  resetRuntimeStore();
  const restore = stubFetch(async () => new Response(JSON.stringify({ ok: false, error: { code: 'BOOM', message: 'no' } }), { status: 500, headers: { 'content-type': 'application/json' } }));
  try {
    const outcome = await useRuntimeStore.getState().bootstrap();
    assert.equal(outcome.ok, false);
    assert.equal(useRuntimeStore.getState().loadState, 'error');
  } finally {
    restore();
    resetRuntimeStore();
  }
});

test('runtimeStore.commitRuntimeState resets the form when the saved token is echoed', () => {
  resetRuntimeStore();
  useRuntimeStore.setState({ githubToken: 'pasted', rememberGitHubToken: true, isEditingGitHubToken: true });
  useRuntimeStore.getState().commitRuntimeState(STATE_FIXTURE);
  assert.equal(useRuntimeStore.getState().githubToken, '');
  assert.equal(useRuntimeStore.getState().rememberGitHubToken, false);
  assert.equal(useRuntimeStore.getState().isEditingGitHubToken, false);
  resetRuntimeStore();
});

test('runtimeStore.commitRuntimeState keeps the typed token when no saved token is echoed', () => {
  resetRuntimeStore();
  useRuntimeStore.setState({ githubToken: 'pasted', rememberGitHubToken: true });
  useRuntimeStore.getState().commitRuntimeState({ ...STATE_FIXTURE, secrets: { hasGitHubToken: false } });
  assert.equal(useRuntimeStore.getState().githubToken, 'pasted');
  assert.equal(useRuntimeStore.getState().rememberGitHubToken, true);
  resetRuntimeStore();
});

test('runtimeStore.beginEditSavedToken clears form; cancel returns to a non-editing state', () => {
  resetRuntimeStore();
  useRuntimeStore.setState({ githubToken: 'old', rememberGitHubToken: true });
  useRuntimeStore.getState().beginEditSavedToken();
  let state = useRuntimeStore.getState();
  assert.equal(state.githubToken, '');
  assert.equal(state.rememberGitHubToken, false);
  assert.equal(state.isEditingGitHubToken, true);
  useRuntimeStore.getState().cancelEditSavedToken();
  state = useRuntimeStore.getState();
  assert.equal(state.isEditingGitHubToken, false);
  resetRuntimeStore();
});

test('selectShouldRememberGitHubToken follows the checkbox unless the user is replacing a saved token', () => {
  resetRuntimeStore();
  useRuntimeStore.setState({ rememberGitHubToken: true, githubToken: 'abc' });
  assert.equal(selectShouldRememberGitHubToken(useRuntimeStore.getState()), true);

  useRuntimeStore.setState({ rememberGitHubToken: false, githubToken: 'abc' });
  assert.equal(selectShouldRememberGitHubToken(useRuntimeStore.getState()), false);

  useRuntimeStore.setState({
    state: { ...STATE_FIXTURE, secrets: { hasGitHubToken: true } },
    isEditingGitHubToken: true,
    rememberGitHubToken: false,
    githubToken: 'replacement',
  });
  assert.equal(selectShouldRememberGitHubToken(useRuntimeStore.getState()), true);

  useRuntimeStore.setState({ githubToken: '   ' });
  assert.equal(selectShouldRememberGitHubToken(useRuntimeStore.getState()), false);

  resetRuntimeStore();
});

test('selectRequestStatePath prefers the typed override over the runtime echo', () => {
  resetRuntimeStore();
  useRuntimeStore.setState({ state: STATE_FIXTURE, statePath: '' });
  assert.equal(selectRequestStatePath(useRuntimeStore.getState()), '/tmp/agentcfg-state.json');

  useRuntimeStore.setState({ statePath: '   ' });
  assert.equal(selectRequestStatePath(useRuntimeStore.getState()), '/tmp/agentcfg-state.json');

  useRuntimeStore.setState({ statePath: '/custom/path  ' });
  assert.equal(selectRequestStatePath(useRuntimeStore.getState()), '/custom/path');
  resetRuntimeStore();
});
