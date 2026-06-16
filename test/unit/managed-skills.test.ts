import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MANAGED_AGENT_SKILLS_GIST_FILE,
  applyManagedAgentSkillsPlan,
  createManagedAgentSkillsManifest,
  parseManagedAgentSkillsManifest,
  planManagedAgentSkillsApply,
  serializeManagedAgentSkillsManifest,
} from '../../src/core/managed-skills';
import { buildGistBody, startFakeGistServer } from '../helpers/fake-gist';

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
  '      value: test-secret-value',
  '    models:',
  '      gpt-4.1-mini: {}',
  '',
].join('\n');

test('managed agent skills mirrors remote manifest with backups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-managed-skills-'));
  const skillsRoot = join(directory, '.agents', 'skills');
  const remoteHome = await mkdtemp(join(tmpdir(), 'agentcfg-managed-skills-remote-'));
  const remoteRoot = join(remoteHome, '.agents', 'skills');

  try {
    await mkdir(join(skillsRoot, 'stale'), { recursive: true });
    await mkdir(join(skillsRoot, 'shared'), { recursive: true });
    await writeFile(join(skillsRoot, 'stale', 'SKILL.md'), '# stale\n');
    await writeFile(join(skillsRoot, 'shared', 'SKILL.md'), '# local shared\n');

    await mkdir(join(remoteRoot, 'new-skill'), { recursive: true });
    await mkdir(join(remoteRoot, 'shared'), { recursive: true });
    await writeFile(join(remoteRoot, 'new-skill', 'SKILL.md'), '# remote new\n');
    await writeFile(join(remoteRoot, 'shared', 'SKILL.md'), '# remote shared\n');
    await writeFile(join(remoteRoot, 'shared', 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
    const manifest = await createManagedAgentSkillsManifest(remoteHome);

    const server = await startFakeGistServer({
      status: 200,
      body: buildGistBody(VALID_AGENTCFG_YAML, 'skills-revision', {
        [MANAGED_AGENT_SKILLS_GIST_FILE]: { content: serializeManagedAgentSkillsManifest(manifest) },
      }),
    });

    try {
      const plan = await planManagedAgentSkillsApply('skills-gist', { apiBaseUrl: server.apiBaseUrl, env: {} }, directory);

      assert.equal(plan.status, 'would-change');
      assert.deepEqual(
        plan.operations.map((operation) => [operation.action, operation.path]),
        [
          ['create', 'new-skill/SKILL.md'],
          ['create', 'shared/run.sh'],
          ['update', 'shared/SKILL.md'],
          ['delete', 'stale/SKILL.md'],
        ],
      );

      const result = await applyManagedAgentSkillsPlan(plan);
      assert.equal(result.status, 'applied');
      assert.equal(result.backupPaths.length, 2);
      assert.equal(await readFile(join(skillsRoot, 'new-skill', 'SKILL.md'), 'utf8'), '# remote new\n');
      assert.equal(await readFile(join(skillsRoot, 'shared', 'SKILL.md'), 'utf8'), '# remote shared\n');
      assert.equal((await stat(join(skillsRoot, 'shared', 'run.sh'))).mode & 0o777, 0o755);
      await assert.rejects(readFile(join(skillsRoot, 'stale', 'SKILL.md'), 'utf8'), { code: 'ENOENT' });
    } finally {
      await server.close();
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
    await rm(remoteHome, { force: true, recursive: true });
  }
});

test('managed agent skills manifest rejects unsafe paths', () => {
  assert.throws(
    () =>
      parseManagedAgentSkillsManifest(
        JSON.stringify({
          schemaVersion: 1,
          kind: 'agentcfg.agentSkills',
          root: '~/.agents/skills',
          files: [{ path: '../escape', encoding: 'utf8', content: '', mode: 0o644 }],
        }),
      ),
    /Unsafe agent skills path/,
  );
});
