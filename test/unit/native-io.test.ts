import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  NativeConfigParseError,
  parseNativeConfig,
  readNativeConfig,
  serializeNativeConfig,
  writeNativeConfig,
} from '../../src/core';

test('native JSON parses and serializes pretty JSON', () => {
  const parsed = parseNativeConfig('{"provider":"openai","enabled":true}', 'json');

  assert.deepEqual(parsed, { provider: 'openai', enabled: true });
  assert.equal(serializeNativeConfig(parsed, 'json'), '{\n  "provider": "openai",\n  "enabled": true\n}\n');
});

test('native JSONC parses comments and trailing commas, then serializes structurally without comments', () => {
  const parsed = parseNativeConfig(
    `{
      // OpenCode fixture shape
      "provider": "openai",
      "settings": {
        "enabled": true,
      },
    }`,
    'jsonc',
  );

  assert.deepEqual(parsed, { provider: 'openai', settings: { enabled: true } });
  assert.equal(
    serializeNativeConfig(parsed, 'jsonc'),
    '{\n  "provider": "openai",\n  "settings": {\n    "enabled": true\n  }\n}\n',
  );
});

test('native JSON5 parser handles comments, trailing commas, single quotes, unquoted keys, and JSON5 numbers', () => {
  const parsed = parseNativeConfig(
    `{
      provider: 'openai',
      baseURL: 'https://example.test/v1',
      limits: [0x10, +2, .5],
      nested: {
        model: 'gpt-test',
      },
    }`,
    'json5',
  );

  assert.deepEqual(parsed, {
    provider: 'openai',
    baseURL: 'https://example.test/v1',
    limits: [16, 2, 0.5],
    nested: { model: 'gpt-test' },
  });
});

test('native TOML parses package-backed scalars, arrays, inline tables, dotted keys, and nested table paths', () => {
  const parsed = parseNativeConfig(
    `provider = "openai"
enabled = true
limits.requests = 5
servers = ["primary", "fallback"]
settings = { retries = 3, labels = ["managed"] }

[model.providers.openai]
baseURL = "https://example.test/v1"
temperature = 0.5
`,
    'toml',
  );

  assert.deepEqual(parsed, {
    provider: 'openai',
    enabled: true,
    limits: { requests: 5 },
    servers: ['primary', 'fallback'],
    settings: { retries: 3, labels: ['managed'] },
    model: {
      providers: {
        openai: {
          baseURL: 'https://example.test/v1',
          temperature: 0.5,
        },
      },
    },
  });
});

test('native TOML serializes simple scalars and nested tables', () => {
  assert.equal(
    serializeNativeConfig(
      {
        provider: 'openai',
        enabled: true,
        servers: ['primary', 'fallback'],
        model: {
          providers: {
            openai: {
              baseURL: 'https://example.test/v1',
            },
          },
        },
      },
      'toml',
    ),
    'provider = "openai"\nenabled = true\nservers = [ "primary", "fallback" ]\n\n[model.providers.openai]\nbaseURL = "https://example.test/v1"\n',
  );
});

test('native-parse-malformed fails closed with actionable JSONC errors', () => {
  assert.throws(
    () => parseNativeConfig('{ "provider": "openai", } trailing', 'jsonc'),
    (error) => {
      assert.ok(error instanceof NativeConfigParseError);
      assert.equal(error.format, 'jsonc');
      assert.match(error.message, /Malformed JSONC native config/);
      assert.match(error.message, /InvalidSymbol at line 1, column 27/);
      return true;
    },
  );
});

test('native malformed TOML fails closed with package parser errors', () => {
  assert.throws(
    () => parseNativeConfig('provider "openai"', 'toml'),
    /Malformed TOML native config: Invalid TOML document: incomplete key-value/,
  );
});

test('native IO reads and writes through format detection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentcfg-native-'));
  const filePath = join(directory, 'config.jsonc');

  try {
    await writeNativeConfig(filePath, { provider: 'openai' }, undefined, {
      createBackup: false,
    });

    assert.equal(await readFile(filePath, 'utf8'), '{\n  "provider": "openai"\n}\n');
    assert.deepEqual(await readNativeConfig(filePath), { provider: 'openai' });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
