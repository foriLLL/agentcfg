#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

check_ignored() {
  local ignored_output
  if ! ignored_output=$(git -C "$ROOT_DIR" check-ignore -v .agentcfg-state.json secrets.json 2>/dev/null); then
    printf 'FAIL: private state/secret filenames are not ignored by .gitignore\n' >&2
    exit 1
  fi

  for filename in .agentcfg-state.json secrets.json; do
    if [[ "$ignored_output" != *"$filename"* ]]; then
      printf 'FAIL: %s is not ignored by .gitignore\n' "$filename" >&2
      exit 1
    fi
  done
}

check_untracked() {
  for filename in .agentcfg-state.json secrets.json; do
    if git -C "$ROOT_DIR" ls-files --error-unmatch -- "$filename" >/dev/null 2>&1; then
      printf 'FAIL: %s is tracked in git\n' "$filename" >&2
      exit 1
    fi
  done
}

check_not_staged() {
  local staged_output
  staged_output=$(git -C "$ROOT_DIR" diff --cached --name-only -- .agentcfg-state.json secrets.json)
  if [[ -n "$staged_output" ]]; then
    printf 'FAIL: private state/secret filenames are staged in git\n' >&2
    exit 1
  fi
}

check_history() {
  local history_output
  history_output=$(git -C "$ROOT_DIR" log --all --name-only --pretty=format: -- .agentcfg-state.json secrets.json)
  if [[ -n "$history_output" ]]; then
    printf 'Release blocker: private state/secret filename found in git history. Stop and decide rotation/history remediation manually.\n'
    exit 1
  fi
}

check_ignored
check_untracked
check_not_staged
check_history

printf 'Ignored: .agentcfg-state.json, secrets.json\n'
printf 'Untracked: .agentcfg-state.json, secrets.json\n'
printf 'Unstaged: .agentcfg-state.json, secrets.json\n'
printf 'Absent from history: .agentcfg-state.json, secrets.json\n'
