import assert from 'node:assert/strict';
import test from 'node:test';
import { useRemoteDraftStore, useRuntimeStore } from '../../../web/src/stores';
import type { EditableAgentConfig } from '../../../web/src/api';

const INITIAL_REMOTE_SLOT = useRemoteDraftStore.getState();
const INITIAL_RUNTIME_SLOT = useRuntimeStore.getState();

function reset(): void {
  useRemoteDraftStore.setState(INITIAL_REMOTE_SLOT, true);
  useRuntimeStore.setState(INITIAL_RUNTIME_SLOT, true);
}

const TWO_PROVIDERS_DRAFT: EditableAgentConfig = {
  schemaVersion: 1,
  defaults: { provider: 'openai', model: 'gpt-4.1-mini' },
  providers: {
    openai: {
      baseURL: 'https://api.openai.com/v1',
      apiKey: { type: 'plain', value: 'sk-openai' },
      models: { 'gpt-4.1-mini': {} },
    },
    anthropic: {
      baseURL: 'https://api.anthropic.com/v1',
      apiKey: { type: 'plain', value: 'sk-anthropic' },
      models: { 'claude-3-5-sonnet-latest': {} },
    },
  },
  ohMyOpenAgent: {
    agents: { oracle: { model: 'openai/gpt-4.1-mini', variant: 'high' } },
  },
};

test('replaceDraft picks first valid provider/model when defaults are stale', () => {
  reset();
  const stale: EditableAgentConfig = {
    schemaVersion: 1,
    defaults: { provider: 'missing', model: 'nope' },
    providers: TWO_PROVIDERS_DRAFT.providers,
  };
  useRemoteDraftStore.getState().replaceDraft(stale);
  const state = useRemoteDraftStore.getState();
  assert.equal(state.editorProviderId, 'openai');
  assert.equal(state.editorModelId, 'gpt-4.1-mini');
  reset();
});

test('addProvider produces a unique id and focuses it', () => {
  reset();
  useRemoteDraftStore.getState().replaceDraft(TWO_PROVIDERS_DRAFT);
  useRemoteDraftStore.getState().addProvider();
  const state = useRemoteDraftStore.getState();
  assert.equal(state.editorProviderId, 'provider');
  assert.equal(state.editorModelId, 'model');
  assert.deepEqual(Object.keys(state.draft.providers).sort(), ['anthropic', 'openai', 'provider']);
  reset();
});

test('removeProvider keeps the only provider intact', () => {
  reset();
  const single: EditableAgentConfig = {
    schemaVersion: 1,
    defaults: { provider: 'openai', model: 'gpt-4.1-mini' },
    providers: { openai: TWO_PROVIDERS_DRAFT.providers.openai },
  };
  useRemoteDraftStore.getState().replaceDraft(single);
  useRemoteDraftStore.getState().removeProvider();
  assert.deepEqual(Object.keys(useRemoteDraftStore.getState().draft.providers), ['openai']);
  reset();
});

test('removeProvider drops the focused provider and re-points defaults when needed', () => {
  reset();
  useRemoteDraftStore.getState().replaceDraft(TWO_PROVIDERS_DRAFT);
  useRemoteDraftStore.getState().selectProvider('openai');
  useRemoteDraftStore.getState().removeProvider();
  const state = useRemoteDraftStore.getState();
  assert.equal(state.editorProviderId, 'anthropic');
  assert.equal(state.draft.defaults.provider, 'anthropic');
  assert.equal(state.draft.providers.openai, undefined);
  assert.equal(state.draft.ohMyOpenAgent, undefined, 'stale ohMyOpenAgent reference should be dropped');
  reset();
});

test('renameProvider rejects duplicate ids and keeps the draft unchanged', () => {
  reset();
  useRemoteDraftStore.getState().replaceDraft(TWO_PROVIDERS_DRAFT);
  useRemoteDraftStore.getState().selectProvider('openai');
  const before = useRemoteDraftStore.getState().draft;
  const ok = useRemoteDraftStore.getState().renameProvider('anthropic');
  assert.equal(ok, false);
  assert.equal(useRemoteDraftStore.getState().draft, before);
  reset();
});

test('renameProvider rewires defaults + ohMyOpenAgent references', () => {
  reset();
  useRemoteDraftStore.getState().replaceDraft(TWO_PROVIDERS_DRAFT);
  useRemoteDraftStore.getState().selectProvider('openai');
  const ok = useRemoteDraftStore.getState().renameProvider('openai-alt');
  assert.equal(ok, true);
  const state = useRemoteDraftStore.getState();
  assert.equal(state.editorProviderId, 'openai-alt');
  assert.equal(state.draft.defaults.provider, 'openai-alt');
  assert.equal(state.draft.ohMyOpenAgent?.agents?.oracle.model, 'openai-alt/gpt-4.1-mini');
  reset();
});

test('save() short-circuits with a validation error before issuing any fetch', async () => {
  reset();
  let fetchCalled = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response('{}');
  }) as typeof globalThis.fetch;
  try {
    const broken: EditableAgentConfig = {
      schemaVersion: 1,
      defaults: { provider: 'openai', model: 'gpt-4.1-mini' },
      providers: {
        openai: {
          baseURL: '',
          apiKey: { type: 'plain', value: 'sk-openai' },
          models: { 'gpt-4.1-mini': {} },
        },
      },
    };
    useRemoteDraftStore.getState().replaceDraft(broken);
    const outcome = await useRemoteDraftStore.getState().save();
    assert.equal(outcome.ok, false);
    if (outcome.ok) return;
    assert.equal(outcome.kind, 'validation');
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
    reset();
  }
});
