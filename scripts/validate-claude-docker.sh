#!/usr/bin/env bash
set -u

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FIXTURE_DIR="$ROOT_DIR/test/integration/claude-docker"
SKIP_PREFIX="SKIP: Docker/Claude validation unavailable"
STRICT_SKIP=${AGENTCFG_DOCKER_CLAUDE_STRICT:-0}
CLAUDE_IMAGE=${AGENTCFG_CLAUDE_DOCKER_IMAGE:-docker/sandbox-templates:claude-code}

skip_validation() {
  printf '%s: %s\n' "$SKIP_PREFIX" "$1"
  if [ "$STRICT_SKIP" = "1" ]; then
    exit 77
  fi
  exit 0
}

fail_validation() {
  printf 'FAIL: Docker Claude validation failed: %s\n' "$1" >&2
  exit 1
}

assert_no_fixture_secret_in_logs() {
  local canonical_path="$FIXTURE_DIR/canonical.agentcfg.json"
  local secret
  secret=$(node -e "const fs=require('node:fs'); const config=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const provider=config.providers[config.defaults.provider]; process.stdout.write(provider.apiKey.value);" "$canonical_path") || fail_validation "could not read fixture secret"

  node -e "const fs=require('node:fs'); const secret=process.argv[1]; for (const file of process.argv.slice(2)) { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(secret)) process.exit(1); }" "$secret" "$@"
}

if [ ! -f "$ROOT_DIR/package.json" ]; then
  fail_validation "project package.json was not found"
fi

if [ ! -d "$FIXTURE_DIR" ]; then
  fail_validation "Claude Docker validator fixtures were not found at '$FIXTURE_DIR'"
fi

if ! command -v node >/dev/null 2>&1; then
  fail_validation "node is required to render the Claude fixture"
fi

if ! command -v npm >/dev/null 2>&1; then
  fail_validation "npm is required to build the Claude renderer before Docker validation"
fi

if [ ! -f "$ROOT_DIR/dist/src/adapters/claude.js" ]; then
  build_log=$(mktemp "${TMPDIR:-/tmp}/agentcfg-claude-build.XXXXXX") || fail_validation "could not create build log"
  if ! (cd "$ROOT_DIR" && npm run build) >"$build_log" 2>&1; then
    rm -f "$build_log"
    fail_validation "project build failed before Docker validation"
  fi
  rm -f "$build_log"
fi

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/agentcfg-claude-docker.XXXXXX") || fail_validation "could not create temp directory"
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

GENERATED_SETTINGS="$TMP_ROOT/settings.json"
CONTAINER_SETTINGS="$TMP_ROOT/settings.container.json"
STDOUT_LOG="$TMP_ROOT/claude.stdout.log"
STDERR_LOG="$TMP_ROOT/claude.stderr.log"
PULL_LOG="$TMP_ROOT/docker-pull.log"

if ! node "$FIXTURE_DIR/render-claude-settings.cjs" "$ROOT_DIR" "$GENERATED_SETTINGS" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "fixture renderer wrote the raw fake API key to logs"
  fail_validation "could not render generated Claude Code settings from fixtures"
fi

if ! node "$FIXTURE_DIR/assert-claude-shape.cjs" "$GENERATED_SETTINGS" "$FIXTURE_DIR/canonical.agentcfg.json" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "shape assertion wrote the raw fake API key to logs"
  fail_validation "generated Claude Code settings do not match adapter conventions"
fi

assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "local settings JSON validation wrote the raw fake API key to logs"

if node "$FIXTURE_DIR/assert-claude-shape.cjs" "$FIXTURE_DIR/malformed.settings.json" "$FIXTURE_DIR/canonical.agentcfg.json" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  fail_validation "malformed Claude Code settings fixture unexpectedly passed local JSON validation"
fi

assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "malformed JSON failure-path check wrote the raw fake API key to logs"
chmod 0444 "$GENERATED_SETTINGS" || fail_validation "could not make generated settings read-only"

if ! node -e "const fs=require('node:fs'); const config=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if (!config.env || typeof config.env !== 'object' || Array.isArray(config.env)) throw new Error('generated settings env must be an object'); config.env.ANTHROPIC_API_KEY='agentcfg-docker-redacted-api-key'; fs.writeFileSync(process.argv[2], JSON.stringify(config, null, 2) + '\n');" "$GENERATED_SETTINGS" "$CONTAINER_SETTINGS" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "container settings sanitization wrote the raw fake API key to logs"
  fail_validation "could not sanitize generated Claude Code settings before Docker validation"
fi

assert_no_fixture_secret_in_logs "$CONTAINER_SETTINGS" "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "sanitized container settings still contains the raw fake API key"
chmod 0444 "$CONTAINER_SETTINGS" || fail_validation "could not make sanitized settings read-only"

printf 'Local Claude settings JSON validation passed: generated settings.json has managed model/env fields and malformed JSON is rejected before Docker.\n'

if ! command -v docker >/dev/null 2>&1; then
  skip_validation "docker executable not found on PATH after local settings validation passed"
fi

if ! docker info >/dev/null 2>&1; then
  skip_validation "docker daemon is not reachable after local settings validation passed"
fi

if ! docker image inspect "$CLAUDE_IMAGE" >/dev/null 2>&1; then
  if ! docker pull "$CLAUDE_IMAGE" >"$PULL_LOG" 2>&1; then
    assert_no_fixture_secret_in_logs "$PULL_LOG" || fail_validation "docker pull wrote the raw fake API key to logs"
    skip_validation "Claude Docker image '$CLAUDE_IMAGE' is not available locally and could not be pulled"
  fi
fi

if ! docker run --rm --network none --entrypoint /bin/sh "$CLAUDE_IMAGE" -lc 'command -v claude >/dev/null 2>&1 && claude --version' >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "Claude version check wrote the raw fake API key to logs"
  skip_validation "Claude Docker image '$CLAUDE_IMAGE' did not run the CLI command 'claude --version'"
fi

assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "Claude version check wrote the raw fake API key to logs"
printf 'Docker Claude CLI version smoke passed in %s.\n' "$CLAUDE_IMAGE"

skip_validation "Claude CLI version is available in '$CLAUDE_IMAGE', but no safe non-network settings validation command is available in this image without risking auth, network, or hanging behavior"
