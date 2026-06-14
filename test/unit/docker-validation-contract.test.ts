import assert from 'node:assert/strict';
import { constants, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const PACKAGE_JSON_PATH = resolve(process.cwd(), 'package.json');

const DOCKER_SCRIPT_CONTRACTS = [
  {
    packageScript: 'test:docker:codex',
    command: 'scripts/validate-codex-docker.sh',
    strictEnv: 'AGENTCFG_DOCKER_CODEX_STRICT',
    imageEnv: 'AGENTCFG_CODEX_DOCKER_IMAGE',
    skipPrefix: 'SKIP: Docker/Codex validation unavailable',
  },
  {
    packageScript: 'test:docker:openclaw',
    command: 'scripts/validate-openclaw-docker.sh',
    strictEnv: 'AGENTCFG_DOCKER_OPENCLAW_STRICT',
    imageEnv: 'AGENTCFG_OPENCLAW_DOCKER_IMAGE',
    skipPrefix: 'SKIP: Docker/OpenClaw validation unavailable',
  },
  {
    packageScript: 'test:docker:claude',
    command: 'scripts/validate-claude-docker.sh',
    strictEnv: 'AGENTCFG_DOCKER_CLAUDE_STRICT',
    imageEnv: 'AGENTCFG_CLAUDE_DOCKER_IMAGE',
    skipPrefix: 'SKIP: Docker/Claude validation unavailable',
  },
] as const;

test('package exposes Docker validation scripts for every agent lane', () => {
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.['test:docker:opencode'], 'scripts/validate-opencode-docker.sh');
  assert.equal(
    packageJson.scripts?.['test:docker'],
    'npm run test:docker:opencode && npm run test:docker:codex && npm run test:docker:openclaw && npm run test:docker:claude',
  );

  for (const contract of DOCKER_SCRIPT_CONTRACTS) {
    assert.equal(packageJson.scripts?.[contract.packageScript], contract.command);
  }
});

test('new Docker validation scripts are executable and expose strict skip contracts', () => {
  for (const contract of DOCKER_SCRIPT_CONTRACTS) {
    const scriptPath = resolve(process.cwd(), contract.command);
    const script = readFileSync(scriptPath, 'utf8');
    const scriptMode = statSync(scriptPath).mode;

    assert.equal(scriptMode & constants.S_IXUSR, constants.S_IXUSR, `${contract.command} is not user-executable`);
    assert.ok(script.includes(`SKIP_PREFIX="${contract.skipPrefix}"`), `${contract.command} missing skip prefix`);
    assert.ok(script.includes(`STRICT_SKIP=\${${contract.strictEnv}:-0}`), `${contract.command} missing strict env`);
    assert.ok(script.includes(contract.imageEnv), `${contract.command} missing image env`);
    assert.ok(script.includes('exit 77'), `${contract.command} missing strict skip exit code`);
  }
});
