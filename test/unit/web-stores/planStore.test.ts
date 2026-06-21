import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectIsPlanCurrent,
  selectPlanKey,
  selectTargetRequest,
  usePlanStore,
  useRuntimeStore,
} from '../../../web/src/stores';
import type { ApplyAgentResult, ApplyPlanSummary, PlanApplyRuntimeResponse, RuntimeStateSummary } from '../../../web/src/api';

const INITIAL_PLAN_SLOT = usePlanStore.getState();
const INITIAL_RUNTIME_SLOT = useRuntimeStore.getState();

const STATE_FIXTURE: RuntimeStateSummary = {
  statePath: '/tmp/state.json',
  schemaVersion: 1,
  gist: { present: true, id: 'gist-1' },
  cache: { present: true, updatedAt: '2026-06-14T00:00:00.000Z' },
  conflict: { present: false },
};

function reset(): void {
  usePlanStore.setState(INITIAL_PLAN_SLOT, true);
  useRuntimeStore.setState(INITIAL_RUNTIME_SLOT, true);
  useRuntimeStore.setState({ state: STATE_FIXTURE });
}

function stubFetchOnce(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): () => void {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init) as Response;
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = previous;
  };
}

function jsonEnvelope<T>(data: T): Response {
  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('setTargetMode and setConfigPath both reset confirmationText', () => {
  reset();
  usePlanStore.setState({ confirmationText: 'APPLY' });
  usePlanStore.getState().setTargetMode('codex');
  assert.equal(usePlanStore.getState().confirmationText, '');

  usePlanStore.setState({ confirmationText: 'APPLY' });
  usePlanStore.getState().setConfigPath('/etc/agent.toml');
  assert.equal(usePlanStore.getState().confirmationText, '');
  reset();
});

test('invalidate() clears plan response, plan key, apply results and confirmation together', () => {
  reset();
  usePlanStore.setState({
    planResponse: { plans: [], results: [] } as unknown as PlanApplyRuntimeResponse,
    planKey: 'previous',
    applyResults: [],
    confirmationText: 'APPLY',
  });
  usePlanStore.getState().invalidate();
  const state = usePlanStore.getState();
  assert.equal(state.planResponse, null);
  assert.equal(state.planKey, null);
  assert.equal(state.applyResults, null);
  assert.equal(state.confirmationText, '');
  reset();
});

test('selectTargetRequest returns null when no target is selected', () => {
  reset();
  assert.equal(selectTargetRequest(usePlanStore.getState()), null);
  reset();
});

test('selectTargetRequest carries the runtime statePath and the configPath override', () => {
  reset();
  useRuntimeStore.setState({ statePath: '/custom' });
  usePlanStore.getState().setTargetMode('opencode');
  usePlanStore.getState().setConfigPath('  /opt/agent.json  ');
  const request = selectTargetRequest(usePlanStore.getState());
  assert.deepEqual(request, {
    statePath: '/custom',
    agent: 'opencode',
    configPath: '/opt/agent.json',
  });
  reset();
});

test('target readiness is derivable from primitive targetMode while selectTargetRequest remains an object builder', () => {
  reset();
  useRuntimeStore.setState({ statePath: '/custom' });
  usePlanStore.getState().setTargetMode('opencode');

  const state = usePlanStore.getState();
  const firstRequest = selectTargetRequest(state);
  const secondRequest = selectTargetRequest(state);

  assert.equal(state.targetMode !== '', true);
  assert.deepEqual(firstRequest, secondRequest);
  assert.notEqual(firstRequest, secondRequest, 'selectTargetRequest should not be used directly as a React/zustand hook selector');
  reset();
});

test('selectIsPlanCurrent is true only when planKey matches the current selectPlanKey', () => {
  reset();
  usePlanStore.getState().setTargetMode('codex');
  const request = selectTargetRequest(usePlanStore.getState());
  assert.notEqual(request, null);
  const key = selectPlanKey(usePlanStore.getState());

  usePlanStore.setState({
    planResponse: { plans: [] as ApplyPlanSummary[], results: [] } as unknown as PlanApplyRuntimeResponse,
    planKey: key,
  });
  assert.equal(selectIsPlanCurrent(usePlanStore.getState()), true);

  usePlanStore.getState().setConfigPath('/different');
  assert.equal(selectIsPlanCurrent(usePlanStore.getState()), false);
  reset();
});

test('plan() rejects with targetMissing when no target is selected', async () => {
  reset();
  const outcome = await usePlanStore.getState().plan();
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.targetMissing, true);
  reset();
});

test('plan() stores response + key on success', async () => {
  reset();
  usePlanStore.getState().setTargetMode('codex');
  const fakeResponse = {
    plans: [{ agent: 'codex' }],
    results: [{ agent: 'codex', status: 'would-change' }],
  };
  const restore = stubFetchOnce(async (url) => {
    assert.match(url, /\/api\/apply\/plan/);
    return jsonEnvelope(fakeResponse);
  });
  try {
    const outcome = await usePlanStore.getState().plan();
    assert.equal(outcome.ok, true);
    const state = usePlanStore.getState();
    assert.deepEqual(state.planResponse, fakeResponse);
    assert.notEqual(state.planKey, null);
    assert.equal(state.planKey, selectPlanKey(state));
  } finally {
    restore();
    reset();
  }
});

test('apply() posts the current selected target and clears confirmation on success', async () => {
  reset();
  useRuntimeStore.setState({ statePath: '/custom' });
  usePlanStore.getState().setTargetMode('opencode');
  usePlanStore.getState().setConfigPath('  /opt/opencode.jsonc  ');
  usePlanStore.getState().setConfirmationText('APPLY');

  const fakeResults: ApplyAgentResult[] = [
    { agent: 'opencode', status: 'applied', changes: [], notices: [], backups: ['/tmp/backup'] },
  ];
  const requests: Array<{ url: string; body: unknown }> = [];
  const restore = stubFetchOnce(async (url, init) => {
    requests.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as unknown });
    if (/\/api\/apply$/.test(url)) {
      return jsonEnvelope({ results: fakeResults });
    }
    assert.match(url, /\/api\/state/);
    return jsonEnvelope({ state: STATE_FIXTURE });
  });

  try {
    const outcome = await usePlanStore.getState().apply();
    assert.equal(outcome.ok, true);
    assert.deepEqual(requests, [
      {
        url: '/api/apply',
        body: {
          statePath: '/custom',
          agent: 'opencode',
          configPath: '/opt/opencode.jsonc',
          confirm: 'APPLY',
        },
      },
      { url: '/api/state?statePath=%2Fcustom', body: {} },
    ]);
    const state = usePlanStore.getState();
    assert.deepEqual(state.applyResults, fakeResults);
    assert.equal(state.confirmationText, '');
  } finally {
    restore();
    reset();
  }
});
