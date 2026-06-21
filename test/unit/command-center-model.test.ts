import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isFirstRun, buildOnboardingWorkflow, buildCommandCenterWorkflow, type WorkflowModelInput } from '../../web/src/command-center-model';
import type { RuntimeStateSummary } from '../../web/src/api';

describe('Command Center Model', () => {
  const emptyState: RuntimeStateSummary = {
    statePath: '/test/path',
    schemaVersion: 1,
    gist: { present: false },
    cache: { present: false },
    conflict: { present: false },
  };

  const returningState: RuntimeStateSummary = {
    statePath: '/test/path',
    schemaVersion: 1,
    gist: { present: true },
    cache: { present: true, updatedAt: '2025-01-01T12:00:00Z' },
    conflict: { present: false },
  };

  const legacyCachedState: RuntimeStateSummary = {
    statePath: '/test/path',
    schemaVersion: 1,
    gist: { present: true, id: 'legacy-gist' },
    cache: {
      present: true,
      updatedAt: '2025-01-01T12:00:00Z',
      config: {
        schemaVersion: 1,
        defaults: { provider: 'openai', model: 'gpt-4.1-mini' },
        providers: {
          openai: {
            baseURL: 'https://api.openai.com/v1',
            apiKey: { type: 'plain', value: 'sk-visible-openai' },
            models: {
              'gpt-4.1-mini': {
                variant: 'chat',
                contextWindow: 1047576,
                contextTokens: 1047576,
                maxTokens: 32768,
              },
            },
          },
        },
      },
    },
    conflict: { present: false },
  };

  const baseInput: WorkflowModelInput = {
    runtimeState: emptyState,
    status: {
      isLoading: false,
    },
    isPlanCurrent: false,
    canReview: false,
    applyResults: null,
  };

  test('isFirstRun is true when Gist and cache are missing', () => {
    assert.equal(isFirstRun(baseInput), true);
  });

  test('isFirstRun stays true when only Gist is present but config cache is missing', () => {
    const input = {
      ...baseInput,
      runtimeState: { ...emptyState, gist: { present: true } },
    };
    assert.equal(isFirstRun(input), true);
  });

  test('isFirstRun is false when config cache is present', () => {
    const input = {
      ...baseInput,
      runtimeState: { ...emptyState, cache: { present: true } },
    };
    assert.equal(isFirstRun(input), false);
  });

  test('legacy cached config is treated as a returning-user Home model', () => {
    const input = {
      ...baseInput,
      runtimeState: legacyCachedState,
    };

    assert.equal(isFirstRun(input), false);
    const steps = buildCommandCenterWorkflow(input);
    assert.equal(steps[0].id, 'remote-source');
    assert.equal(steps[0].status, 'complete');
    assert.equal(steps[1].id, 'sync-targets');
    assert.equal(steps[1].status, 'pending');
    assert.equal(steps[1].action.kind, 'navigate');
  });

  test('buildOnboardingWorkflow creates first-run steps', () => {
    const steps = buildOnboardingWorkflow(baseInput);
    assert.equal(steps.length, 3);
    assert.equal(steps[0].id, 'onboarding-connect');
    assert.equal(steps[1].id, 'onboarding-config');
    assert.equal(steps[2].id, 'onboarding-sync');
  });

  test('buildCommandCenterWorkflow creates returning steps', () => {
    const input = {
      ...baseInput,
      runtimeState: returningState,
    };
    const steps = buildCommandCenterWorkflow(input);
    assert.equal(steps.length, 3);
    assert.equal(steps[0].id, 'remote-source');
    assert.equal(steps[1].id, 'sync-targets');
    assert.equal(steps[2].id, 'automation');
  });
});
