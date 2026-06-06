#!/usr/bin/env bash
set -u

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FIXTURE_DIR="$ROOT_DIR/test/integration/opencode-docker"
SKIP_PREFIX="SKIP: Docker/OpenCode validation unavailable"
STRICT_SKIP=${AGENTCFG_DOCKER_OPENCODE_STRICT:-0}
OPENCODE_IMAGE=${AGENTCFG_OPENCODE_DOCKER_IMAGE:-ghcr.io/anomalyco/opencode:latest}

# Set AGENTCFG_DOCKER_OPENCODE_STRICT=1 when CI should treat a documented skip as exit 77.

skip_validation() {
  printf '%s: %s\n' "$SKIP_PREFIX" "$1"
  if [ "$STRICT_SKIP" = "1" ]; then
    exit 77
  fi
  exit 0
}

fail_validation() {
  printf 'FAIL: Docker OpenCode validation failed: %s\n' "$1" >&2
  exit 1
}

assert_no_fixture_secret_in_logs() {
  local canonical_path="$FIXTURE_DIR/canonical.agentcfg.json"
  local secret
  secret=$(node -e "const fs=require('node:fs'); const config=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(config.apiKey.value);" "$canonical_path") || fail_validation "could not read fixture secret"

  node -e "const fs=require('node:fs'); const secret=process.argv[1]; for (const file of process.argv.slice(2)) { if (fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(secret)) process.exit(1); }" "$secret" "$@"
}

if ! command -v node >/dev/null 2>&1; then
  fail_validation "node is required to render the OpenCode fixture"
fi

if ! command -v npm >/dev/null 2>&1; then
  fail_validation "npm is required to build the OpenCode renderer before Docker validation"
fi

if [ ! -f "$ROOT_DIR/dist/src/adapters/opencode.js" ]; then
  build_log=$(mktemp "${TMPDIR:-/tmp}/agentcfg-opencode-build.XXXXXX") || fail_validation "could not create build log"
  if ! (cd "$ROOT_DIR" && npm run build) >"$build_log" 2>&1; then
    rm -f "$build_log"
    fail_validation "project build failed before Docker validation"
  fi
  rm -f "$build_log"
fi

if ! command -v docker >/dev/null 2>&1; then
  skip_validation "docker executable not found on PATH"
fi

if ! docker info >/dev/null 2>&1; then
  skip_validation "docker daemon is not reachable"
fi

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/agentcfg-opencode-docker.XXXXXX") || fail_validation "could not create temp directory"
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

GENERATED_CONFIG="$TMP_ROOT/opencode.json"
CONTAINER_CONFIG="$TMP_ROOT/opencode.container.json"
CONTAINER_HOME="$TMP_ROOT/home"
CONTAINER_WORK="$TMP_ROOT/work"
STDOUT_LOG="$TMP_ROOT/opencode.stdout.log"
STDERR_LOG="$TMP_ROOT/opencode.stderr.log"
PULL_LOG="$TMP_ROOT/docker-pull.log"

mkdir -p "$CONTAINER_HOME" "$CONTAINER_WORK" || fail_validation "could not create container temp directories"
chmod 0777 "$CONTAINER_HOME" "$CONTAINER_WORK" || fail_validation "could not prepare container temp directories"

if ! node "$FIXTURE_DIR/render-opencode-config.cjs" "$ROOT_DIR" "$GENERATED_CONFIG" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "fixture renderer wrote the raw fake API key to logs"
  fail_validation "could not render generated OpenCode config from fixtures"
fi

if ! node "$FIXTURE_DIR/assert-opencode-shape.cjs" "$GENERATED_CONFIG" "$FIXTURE_DIR/canonical.agentcfg.json" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "shape assertion wrote the raw fake API key to logs"
  fail_validation "generated OpenCode config does not match adapter conventions"
fi

assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "local generation wrote the raw fake API key to logs"
chmod 0444 "$GENERATED_CONFIG" || fail_validation "could not make generated config read-only"

if ! node -e "const fs=require('node:fs'); const config=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const canonical=JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); config.provider[canonical.provider].options.apiKey='agentcfg-docker-redacted-api-key'; fs.writeFileSync(process.argv[3], JSON.stringify(config));" "$GENERATED_CONFIG" "$FIXTURE_DIR/canonical.agentcfg.json" "$CONTAINER_CONFIG" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "container config sanitization wrote the raw fake API key to logs"
  fail_validation "could not sanitize generated OpenCode config before Docker validation"
fi

assert_no_fixture_secret_in_logs "$CONTAINER_CONFIG" "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "sanitized container config still contains the raw fake API key"
chmod 0444 "$CONTAINER_CONFIG" || fail_validation "could not make sanitized config read-only"

if ! docker image inspect "$OPENCODE_IMAGE" >/dev/null 2>&1; then
  if ! docker pull "$OPENCODE_IMAGE" >"$PULL_LOG" 2>&1; then
    assert_no_fixture_secret_in_logs "$PULL_LOG" || fail_validation "docker pull wrote the raw fake API key to logs"
    skip_validation "OpenCode Docker image '$OPENCODE_IMAGE' is not available locally and could not be pulled"
  fi
fi

if ! docker run --rm --network none "$OPENCODE_IMAGE" --version >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "OpenCode version check wrote the raw fake API key to logs"
  skip_validation "OpenCode Docker image '$OPENCODE_IMAGE' did not run the CLI version check"
fi

set +e
docker run --rm --network none \
  --volume "$CONTAINER_CONFIG:/tmp/agentcfg/opencode.json:ro" \
  --volume "$CONTAINER_HOME:/tmp/agentcfg-home" \
  --volume "$CONTAINER_WORK:/workspace" \
  --workdir /workspace \
  --env HOME=/tmp/agentcfg-home \
  --env XDG_CONFIG_HOME=/tmp/agentcfg-home/.config \
  --env XDG_DATA_HOME=/tmp/agentcfg-home/.local/share \
  --env XDG_CACHE_HOME=/tmp/agentcfg-home/.cache \
  --env OPENCODE_CONFIG=/tmp/agentcfg/opencode.json \
  --env OPENCODE_DISABLE_AUTOUPDATE=1 \
  --env OPENCODE_DISABLE_DEFAULT_PLUGINS=1 \
  --env OPENCODE_DISABLE_LSP_DOWNLOAD=1 \
  --env OPENCODE_DISABLE_MODELS_FETCH=1 \
  --env OPENCODE_FAKE_VCS=git \
  "$OPENCODE_IMAGE" --pure debug config >"$STDOUT_LOG" 2>"$STDERR_LOG"
opencode_status=$?
set -e

if ! assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG"; then
  skip_validation "OpenCode CLI debug output would expose the fixture API key, so no safe non-network validation command is available"
fi

if [ "$opencode_status" -ne 0 ]; then
  skip_validation "OpenCode CLI command 'debug config' could not validate the generated config without provider/network access (exit $opencode_status)"
fi

printf 'Docker OpenCode validation passed: generated config parsed in %s without provider network access.\n' "$OPENCODE_IMAGE"
