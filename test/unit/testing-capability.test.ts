import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const TESTING_CAPABILITY_PATH = resolve(process.cwd(), 'docs/testing-capability.md');

const REQUIRED_HEADINGS = [
  'Purpose',
  'Current Verification Lanes',
  'TDD Scenario Contract',
  'Feature Coverage Matrix',
  'Change Workflow',
  'Manual QA Surfaces',
] as const;

const REQUIRED_TEST_LANES = [
  'npm run typecheck',
  'npm run build',
  'npm run build:web',
  'npm run test:unit',
  'npm run test:fixtures',
  'npm run test:api',
  'npm run test:server',
  'npm run test:cli',
  'npm run test:gui',
  'npm run test:docker:opencode',
  'npm test',
] as const;

test('testing capability design documents current verification lanes', () => {
  const design = readTestingCapabilityDesign();

  for (const heading of REQUIRED_HEADINGS) {
    assert.match(design, new RegExp(`^## ${escapeRegExp(heading)}$`, 'm'));
  }

  for (const lane of REQUIRED_TEST_LANES) {
    assert.ok(design.includes(lane), `missing testing lane: ${lane}`);
  }

  assert.ok(design.includes('unit, fixtures, API, server, CLI, GUI, and Docker validation'));
});

test('testing capability design requires TDD scenario contract', () => {
  const design = readTestingCapabilityDesign();

  for (const phrase of [
    'happy path',
    'edge or malformed path',
    'adjacent-surface regression',
    'RED -> GREEN -> SURFACE',
    'failing assertion',
    'binary pass condition',
  ]) {
    assert.ok(design.includes(phrase), `missing TDD contract phrase: ${phrase}`);
  }
});

test('testing capability design covers cross-surface regression gates', () => {
  const design = readTestingCapabilityDesign();

  for (const phrase of [
    'provider API keys remain visible',
    'GitHub tokens never appear in runtime, server, GUI, or state responses',
    'Codex',
    'OpenCode',
    'OpenClaw',
    'model discovery',
    'atomic write',
    'rollback',
  ]) {
    assert.ok(design.includes(phrase), `missing regression gate phrase: ${phrase}`);
  }
});

function readTestingCapabilityDesign(): string {
  return readFileSync(TESTING_CAPABILITY_PATH, 'utf8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
