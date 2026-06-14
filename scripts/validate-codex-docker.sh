#!/usr/bin/env bash
set -u

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FIXTURE_DIR="$ROOT_DIR/test/integration/codex-docker"
SKIP_PREFIX="SKIP: Docker/Codex validation unavailable"
STRICT_SKIP=${AGENTCFG_DOCKER_CODEX_STRICT:-0}
CODEX_IMAGE=${AGENTCFG_CODEX_DOCKER_IMAGE:-docker/sandbox-templates:codex}
LIMITATION_NOTE="Codex has no confirmed upstream full config validator; this check covers TOML/env shape plus best-available container/policy smoke."

skip_validation() {
  printf '%s\012' "$LIMITATION_NOTE"
  printf '%s: %s\012' "$SKIP_PREFIX" "$1"
  if [ "$STRICT_SKIP" = "1" ]; then
    exit 77
  fi
  exit 0
}

fail_validation() {
  printf 'FAIL: Docker Codex validation failed: %s\012' "$1" >&2
  exit 1
}

assert_no_fixture_secret_in_logs() {
  local file
  for file in "$@"; do
    node "$FIXTURE_DIR/assert-no-codex-secret.cjs" "$file" "$FIXTURE_DIR/canonical.agentcfg.json" || return 1
  done
}

if [ ! -f "$ROOT_DIR/package.json" ]; then
  fail_validation "project package.json was not found"
fi

if [ ! -d "$FIXTURE_DIR" ]; then
  fail_validation "Codex Docker validator fixtures were not found at '$FIXTURE_DIR'"
fi

if ! command -v node >/dev/null 2>&1; then
  fail_validation "node is required to render the Codex fixture"
fi

if ! command -v npm >/dev/null 2>&1; then
  fail_validation "npm is required to build the Codex renderer before Docker validation"
fi

if [ ! -f "$ROOT_DIR/dist/src/adapters/codex.js" ]; then
  build_log=$(mktemp "${TMPDIR:-/tmp}/agentcfg-codex-build.XXXXXX") || fail_validation "could not create build log"
  if ! (cd "$ROOT_DIR" && npm run build) >"$build_log" 2>&1; then
    rm -f "$build_log"
    fail_validation "project build failed before Docker validation"
  fi
  rm -f "$build_log"
fi

TMP_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/agentcfg-codex-docker.XXXXXX") || fail_validation "could not create temp directory"
CONTAINER_NAME="agentcfg-codex-validation-$$"
cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

GENERATED_TOML="$TMP_ROOT/config.toml"
GENERATED_ENV="$TMP_ROOT/codex.env"
BAD_TOML="$TMP_ROOT/bad.config.toml"
BAD_ENV="$TMP_ROOT/bad.codex.env"
STDOUT_LOG="$TMP_ROOT/codex.stdout.log"
STDERR_LOG="$TMP_ROOT/codex.stderr.log"

if ! node "$FIXTURE_DIR/render-codex-config.cjs" "$ROOT_DIR" "$GENERATED_TOML" "$GENERATED_ENV" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "fixture renderer wrote the raw fake API key to logs"
  fail_validation "could not render generated Codex config from fixtures"
fi

if ! node "$FIXTURE_DIR/assert-codex-shape.cjs" "$GENERATED_TOML" "$GENERATED_ENV" "$FIXTURE_DIR/canonical.agentcfg.json" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "shape assertion wrote the raw fake API key to logs"
  fail_validation "generated Codex config does not match adapter conventions"
fi

assert_no_fixture_secret_in_logs "$GENERATED_TOML" "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "local Codex generation wrote the raw fake API key to logs or TOML"

if node "$FIXTURE_DIR/render-codex-config.cjs" "$ROOT_DIR" "$BAD_TOML" "$BAD_ENV" "$FIXTURE_DIR/malformed.config.toml" >"$STDOUT_LOG" 2>"$STDERR_LOG"; then
  fail_validation "malformed Codex TOML fixture unexpectedly passed local validation"
fi

assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "malformed TOML failure-path check wrote the raw fake API key to logs"
chmod 0444 "$GENERATED_TOML" "$GENERATED_ENV" || fail_validation "could not make generated Codex payloads read-only"

printf 'Local Codex TOML/env validation passed: generated config parses, env key is managed, malformed TOML is rejected before Docker, and raw fixture secret is absent from logs/TOML.\012'

if ! command -v docker >/dev/null 2>&1; then
  skip_validation "docker executable not found on PATH after local Codex validation passed"
fi

if ! docker info >/dev/null 2>&1; then
  skip_validation "docker daemon is not reachable after local Codex validation passed"
fi

if ! docker image inspect "$CODEX_IMAGE" >/dev/null 2>&1; then
  skip_validation "Codex Docker image '$CODEX_IMAGE' is not available locally; not pulling automatically to keep validation bounded"
fi

set +e
docker run --rm --name "$CONTAINER_NAME" --network none --entrypoint /bin/sh "$CODEX_IMAGE" -lc 'if command -v codex >/dev/null 2>&1; then codex --version || codex --help; else exit 127; fi' >"$STDOUT_LOG" 2>"$STDERR_LOG" &
docker_pid=$!
elapsed=0
while kill -0 "$docker_pid" >/dev/null 2>&1; do
  if [ "$elapsed" -ge 30 ]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    wait "$docker_pid" >/dev/null 2>&1
    set -u
    assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "Codex Docker timeout logs contained the raw fake API key"
    skip_validation "Codex Docker image '$CODEX_IMAGE' did not finish the bounded CLI version/help smoke within 30 seconds"
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done
wait "$docker_pid"
version_status=$?
set -u

assert_no_fixture_secret_in_logs "$STDOUT_LOG" "$STDERR_LOG" || fail_validation "Codex CLI smoke wrote the raw fake API key to logs"

if [ "$version_status" -ne 0 ]; then
  skip_validation "Codex Docker image '$CODEX_IMAGE' did not run a safe terminating CLI version/help smoke (exit $version_status)"
fi

printf 'Docker Codex CLI version/help smoke passed in %s.\012' "$CODEX_IMAGE"
skip_validation "Codex CLI is available in '$CODEX_IMAGE', but no confirmed safe non-network upstream config validator or execpolicy check is available without risking auth, provider access, or hanging behavior"
