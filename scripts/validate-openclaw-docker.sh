#!/usr/bin/env bash
set -u

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FIXTURE_DIR="$ROOT_DIR/test/integration/openclaw-docker"
SKIP_PREFIX="SKIP: Docker/OpenClaw validation unavailable"
STRICT_SKIP=${AGENTCFG_DOCKER_OPENCLAW_STRICT:-0}
OPENCLAW_IMAGE=${AGENTCFG_OPENCLAW_DOCKER_IMAGE:-ghcr.io/openclaw/openclaw:latest}
CONTAINER_OPENCLAW_CONFIG=/tmp/agentcfg/openclaw.json

skip_validation() {
  printf '%s: %s\n' "$SKIP_PREFIX" "$1"
  if [ "$STRICT_SKIP" = "1" ]; then
    exit 77
  fi
  exit 0
}

fail_validation() {
  printf 'FAIL: Docker OpenClaw validation failed: %s\n' "$1" >&2
  exit 1
}

assert_no_fixture_secret_in_logs() {
  node "$FIXTURE_DIR/assert-no-openclaw-secret.cjs" "$FIXTURE_DIR/canonical.agentcfg.json" "$@"
}

if [ ! -f "$ROOT_DIR/package.json" ]; then
  fail_validation "project package.json was not found"
fi

if [ ! -d "$FIXTURE_DIR" ]; then
  fail_validation "OpenClaw Docker fixture path '$FIXTURE_DIR' was not found"
fi

if ! command -v node >/dev/null 2>&1; then
  fail_validation "node is required to render the OpenClaw fixture"
fi

if ! command -v npm >/dev/null 2>&1; then
  fail_validation "npm is required to build the OpenClaw renderer before Docker validation"
fi

if [ ! -f "$ROOT_DIR/dist/src/adapters/openclaw.js" ]; then
  build_log=$(mktemp "${TMPDIR:-/tmp}/agentcfg-openclaw-build.XXXXXX") || fail_validation "could not create build log"
  if ! (cd "$ROOT_DIR" && npm run build) >"$build_log" 2>&1; then
    rm -f "$build_log"
    fail_validation "project build failed before Docker validation"
  fi
  rm -f "$build_log"
fi

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/agentcfg-openclaw-docker.XXXXXX") || fail_validation "could not create temp directory"
cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

GENERATED_CONFIG="$TMP_ROOT/openclaw.json"
CONTAINER_CONFIG="$TMP_ROOT/openclaw.container.json"
CONTAINER_HOME="$TMP_ROOT/home"
CONTAINER_WORK="$TMP_ROOT/work"
STDOUT_LOG="$TMP_ROOT/openclaw.stdout.log"
STDERR_LOG="$TMP_ROOT/openclaw.stderr.log"
PULL_LOG="$TMP_ROOT/docker-pull.log"

mkdir -p "$CONTAINER_HOME" "$CONTAINER_WORK" || fail_validation "could not create container temp directories"
chmod 0777 "$CONTAINER_HOME" "$CONTAINER_WORK" || fail_validation "could not prepare container temp directories"

if ! node "$FIXTURE_DIR/render-openclaw-config.cjs" "$ROOT_DIR" "$GENERATED_CONFIG" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "fixture renderer wrote a raw fake API key to logs"
  fail_validation "could not render generated OpenClaw config from fixtures"
fi

if ! node "$FIXTURE_DIR/assert-openclaw-shape.cjs" "$GENERATED_CONFIG" "$FIXTURE_DIR/canonical.agentcfg.json" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "shape assertion wrote a raw fake API key to logs"
  fail_validation "generated OpenClaw config does not match adapter conventions"
fi

assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "local generation wrote a raw fake API key to logs"
chmod 0444 "$GENERATED_CONFIG" || fail_validation "could not make generated config read-only"

if ! node "$FIXTURE_DIR/sanitize-openclaw-config.cjs" "$GENERATED_CONFIG" "$FIXTURE_DIR/canonical.agentcfg.json" "$CONTAINER_CONFIG" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "container config sanitization wrote a raw fake API key to logs"
  fail_validation "could not sanitize generated OpenClaw config before Docker validation"
fi

assert_no_fixture_secret_in_logs "$CONTAINER_CONFIG" "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "sanitized container config still contains a raw fake API key"
chmod 0444 "$CONTAINER_CONFIG" || fail_validation "could not make sanitized config read-only"

if ! command -v docker >/dev/null 2>&1; then
  skip_validation "docker executable not found on PATH after local OpenClaw render and secret guards passed"
fi

if ! docker info >/dev/null 2>&1; then
  skip_validation "docker daemon is not reachable after local OpenClaw render and secret guards passed"
fi

if ! docker image inspect "$OPENCLAW_IMAGE" >/dev/null 2>&1; then
  if ! docker pull "$OPENCLAW_IMAGE" >"$PULL_LOG" 2>&1; then
    assert_no_fixture_secret_in_logs "$PULL_LOG" || fail_validation "docker pull wrote a raw fake API key to logs"
    skip_validation "OpenClaw Docker image '$OPENCLAW_IMAGE' is not available locally and could not be pulled"
  fi
fi

set +e
docker run --rm --network none \
  --volume "$CONTAINER_HOME:/tmp/agentcfg-home" \
  --workdir /tmp/agentcfg-home \
  --env HOME=/tmp/agentcfg-home \
  --env XDG_CONFIG_HOME=/tmp/agentcfg-home/.config \
  --env XDG_DATA_HOME=/tmp/agentcfg-home/.local/share \
  --env XDG_CACHE_HOME=/tmp/agentcfg-home/.cache \
  --env OPENCLAW_DISABLE_AUTOUPDATE=1 \
  "$OPENCLAW_IMAGE" openclaw --version >"$STDOUT_LOG" 2>"$STDERR_LOG"
version_status=$?
set -u

if ! assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG"; then
  fail_validation "OpenClaw version check wrote a raw fake API key to logs"
fi

if [ "$version_status" -ne 0 ]; then
  skip_validation "OpenClaw Docker image '$OPENCLAW_IMAGE' did not run the CLI version check 'openclaw --version'"
fi

VALIDATION_COMMAND="OPENCLAW_CONFIG_PATH=$CONTAINER_OPENCLAW_CONFIG openclaw config validate --json"

set +e
docker run --rm --network none \
  --volume "$CONTAINER_CONFIG:$CONTAINER_OPENCLAW_CONFIG:ro" \
  --volume "$CONTAINER_HOME:/tmp/agentcfg-home" \
  --volume "$CONTAINER_WORK:/workspace" \
  --workdir /workspace \
  --env HOME=/tmp/agentcfg-home \
  --env XDG_CONFIG_HOME=/tmp/agentcfg-home/.config \
  --env XDG_DATA_HOME=/tmp/agentcfg-home/.local/share \
  --env XDG_CACHE_HOME=/tmp/agentcfg-home/.cache \
  --env OPENCLAW_CONFIG_PATH="$CONTAINER_OPENCLAW_CONFIG" \
  --env OPENCLAW_DISABLE_AUTOUPDATE=1 \
  "$OPENCLAW_IMAGE" openclaw config validate --json >"$STDOUT_LOG" 2>"$STDERR_LOG"
validation_status=$?
set -u

if ! assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG"; then
  fail_validation "OpenClaw validation command wrote a raw fake API key to logs"
fi

if [ "$validation_status" -ne 0 ]; then
  skip_validation "OpenClaw CLI command '$VALIDATION_COMMAND' was not accepted by image '$OPENCLAW_IMAGE' without provider/network access (exit $validation_status)"
fi

printf 'Docker OpenClaw validation passed: image %s accepted generated config with command: %s\n' "$OPENCLAW_IMAGE" "$VALIDATION_COMMAND"
