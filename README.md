# agentcfg

agentcfg is a CLI for keeping Codex, OpenCode, and OpenClaw aligned across devices from one canonical `agentcfg.yaml` stored in a private GitHub Gist.

It is built for people who want one safe sync path instead of hand editing several agent config files.

## Security warning

This MVP stores provider and agent API keys in plain text in the private Gist's `agentcfg.yaml`.

A private Gist is not a hard security boundary, and it is not encryption. Use it for convenience, not for secrets you need to hide from the Gist owner or anyone who can read the account.

Encryption is deferred to a later release.

## MVP scope

The MVP manages one canonical config file in a private Gist and applies these managed fields only:

- `provider`
- `model`
- `baseURL`
- `apiKey`

Source of truth works like this, the Gist wins for managed fields and local native config keeps everything else.

Unmanaged native fields stay in place structurally, so agentcfg does not delete unrelated settings just because it does not manage them.

## Canonical schema

`agentcfg.yaml` must use `schemaVersion: 1`.

Minimal example:

```yaml
schemaVersion: 1
provider: openai
model: gpt-4.1-mini
baseURL: https://api.openai.com/v1
apiKey: sk-test-redacted
```

The sample file in `examples/agentcfg.yaml` uses the same shape.

## Gist auth and state

agentcfg reads the canonical config from exactly one file in the Gist, `agentcfg.yaml`.

Authentication works in this order:

1. `GITHUB_TOKEN`
2. `gh auth token` if GitHub CLI is installed and signed in

Run `agentcfg init --gist <gist-id>` first so the CLI knows which Gist to read.

By default, local state lives at `~/.agentcfg/state.json`. Use `--state <path>` if you want a different file.

## Setup

From the `agentcfg/` directory:

```sh
PATH="/opt/homebrew/bin:$PATH" npm install
PATH="/opt/homebrew/bin:$PATH" npm run build
PATH="/opt/homebrew/bin:$PATH" npm test
PATH="/opt/homebrew/bin:$PATH" npm run test:docker:opencode
```

## Commands

### `agentcfg init --gist <gist-id>`

Stores the Gist ID in local state.

Use `--state <path>` to write somewhere other than `~/.agentcfg/state.json`.

### `agentcfg pull`

Fetches `agentcfg.yaml`, validates it, and refreshes the local cache.

`pull` does not write to native agent config files.

### `agentcfg diff`

Shows masked managed-field differences only.

Use exactly one target selector:

- `--agent <codex|opencode|openclaw>`
- `--all-agents`

Common flags:

- `--state <path>` selects the local state file.
- `--config-path <path>` points at one native config file or directory.
- `--fixtures-root <path>` is test-only and points at fixture roots.

`diff` writes nothing.

### `agentcfg apply --dry-run`

Validates the selected agent configs and prints the planned changes without writing files.

### `agentcfg apply --yes`

Applies the selected agent configs after validation.

Use the same target selector and path flags as `diff`.

`apply` creates backups before writes, writes atomically, and asks for confirmation unless `--yes` is set.

## Adapter behavior

### Codex

Codex uses TOML for the native config and a generated env file at `~/.agentcfg/env/codex.env`.

The env file stores the secret, and agentcfg writes it with restrictive permissions.

### OpenCode

OpenCode uses JSON or JSONC.

agentcfg updates the top-level `model` and the selected provider’s `options` fields for `baseURL` and `apiKey`.

### OpenClaw

OpenClaw uses JSON5.

agentcfg updates the nested provider/default model fields and the selected provider entry under `models.providers`.

## Managed and unmanaged fields

Managed fields come from the Gist and replace the native values for the active provider.

Unmanaged fields are preserved structurally. That means agentcfg keeps unrelated native settings, but it does not promise byte-for-byte formatting or comment preservation when a file is rewritten.

If an adapter sees unsupported includes, interpolation, or an ambiguous native shape in a managed path, it fails closed instead of guessing.

## Backups and rollback

Before every write, agentcfg creates a backup and then writes the new file atomically.

If validation fails, nothing is written.

If you need to roll back, restore the latest backup for that file.

Secret-bearing outputs such as `~/.agentcfg/env/codex.env` are written with restrictive permissions, typically `0600`.

## Docker OpenCode validation

`PATH="/opt/homebrew/bin:$PATH" npm run test:docker:opencode` checks the generated OpenCode config in Docker when Docker and the upstream image are available.

If Docker or the upstream OpenCode install is unavailable, the script may exit cleanly with:

`SKIP: Docker/OpenCode validation unavailable`

That skip is acceptable for local development.

## Non-goals

MVP does not include:

- encryption
- desktop or web UI
- per-device profiles
- daemon, watch, or background sync
- automatic model discovery
- provider API key validation
- secret rotation
- agent installation management
- every-agent support
