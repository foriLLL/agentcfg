# agentcfg

语言：[English](README.md) | 中文

agentcfg 是一个 CLI，用来让 Codex、OpenCode、OpenClaw 和 Claude Code 在多台设备之间保持配置一致。它使用存储在私有 GitHub Gist 中的一个规范化 `agentcfg.yaml` 作为统一配置来源。

它适合希望通过一条安全同步路径管理多个 Agent 配置文件，而不是手动编辑多份配置的人。

## 安全警告

当前 MVP 会把 provider 和 agent 的 API Key 以明文形式存储在私有 Gist 的 `agentcfg.yaml` 中。

私有 Gist 不是严格的安全边界，也不是加密。它适合便利同步，不适合存放你需要对 Gist 所有者或任何可读取该账号的人隐藏的密钥。

加密会延后到后续版本。

## MVP 范围

MVP 管理私有 Gist 中的一个规范化配置文件，并从以下 provider catalog 中应用选中的 provider/model：

- `defaults.provider`
- `defaults.model`
- `providers.<provider>.baseURL`
- `providers.<provider>.apiKey`
- `providers.<provider>.models.<model>` metadata
- 可选的 `providers.<provider>.modelDiscovery.path`
- 可选的 `ohMyOpenAgent.agents.<agent>.model` / `variant`
- 可选的 `ohMyOpenAgent.categories.<category>.model` / `variant`

Source of truth 的规则是：Gist 对受管理字段生效，本地原生配置保留其他所有内容。

未受管理的原生字段会按结构保留，因此 agentcfg 不会因为自己不管理某些设置就删除它们。

## 规范化 schema

`agentcfg.yaml` 必须使用 `schemaVersion: 1`。

最小示例：

```yaml
schemaVersion: 1
defaults:
  provider: openai
  model: gpt-4.1-mini
providers:
  openai:
    baseURL: https://api.openai.com/v1
    apiKey:
      type: plain
      value: sk-test-redacted
    modelDiscovery:
      path: /models
    models:
      gpt-4.1-mini:
        variant: chat
        contextWindow: 1047576
        contextTokens: 1047576
        maxTokens: 32768
ohMyOpenAgent:
  agents:
    oracle:
      model: openai/gpt-4.1-mini
      variant: high
  categories:
    visual-engineering:
      model: openai/gpt-4.1-mini
```

`ohMyOpenAgent` 是 OhMyOpenAgent 官方模型路由的可选专用区块。`model` 必须用 `provider/model` 引用上方 provider catalog；空映射不会写入生成的 YAML。

Provider ID 不能包含 `/`，因为 `ohMyOpenAgent` 使用 `/` 作为 `provider/model` 分隔符。Model ID 仍然可以包含 `/`，例如 OpenRouter 风格的模型名。

`examples/agentcfg.yaml` 中的示例文件使用相同结构。

## Gist 认证与状态

agentcfg 只会从 Gist 中的一个文件读取规范化配置：`agentcfg.yaml`。

认证顺序如下：

1. `GITHUB_TOKEN`
2. 如果已安装 GitHub CLI 且已登录，则使用 `gh auth token`

先运行 `agentcfg init --gist <gist-id>`，让 CLI 知道应该读取哪个 Gist。

默认情况下，本地状态位于 `~/.agentcfg/state.json`。如果需要使用其他文件，可以传入 `--state <path>`。

Web UI 可以选择记住用于 Gist 操作的 GitHub Token。启用后，agentcfg 会把它作为本地明文存储到所选 state file 旁边的 `secrets.json` 中，通常是 `~/.agentcfg/secrets.json`，并使用受限文件权限。运行时 API 响应只会报告 token 是否已保存；不会返回保存的 token 值。可以使用 Web UI 的 clear-token 控件删除它。

## Web UI

agentcfg 包含一个本地 Web UI，用于 init、pull、diff review、dry-run planning 和确认 apply 流程。

UI 会显示当前状态、缓存配置、远端 Gist metadata，以及 provider API Key，显示内容与本地 runtime API 将要写入的值保持一致。请把 Web UI 视为 trusted-local 工具。

apply 页面使用强确认流程。你必须先运行 dry-run，选择目标 agents，并输入 `APPLY`，UI 才会发送写入请求。

Web UI 遵循与 CLI 相同的安全警告。私有 Gist 会以明文存储 provider 和 agent API Key，因此不要把它当作 secret vault。

如果选择记住 GitHub Token，UI 会把该 token 写入本地明文 `secrets.json`。这只适合可信任的本机环境。

### 本地运行

在 `agentcfg/` 目录中运行：

```sh
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" npm run build:web
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" npm run build
PATH="/usr/local/bin:/opt/homebrew/bin:$PATH" agentcfg web
```

`agentcfg web` 会启动本地 server，提供已构建的 UI，并打开浏览器；除非传入 `--no-open`，或当前环境禁止自动打开浏览器。

如果需要不同的 bind 或 state file，可以使用这些选项：

- `--host <host>` 绑定到不同 host，默认是 `127.0.0.1`。显式非 loopback 值，例如 `0.0.0.0` 或 `::` 是允许的，但 CLI 和浏览器 UI 会用中文警告局域网设备可能访问并修改本机 Agent 配置；只应在可信网络中使用。
- `--port <port>` 绑定到不同 port，默认是 `8787`；`0` 表示使用临时端口。
- `--state <path>` 让 UI 和 API 使用不同的 state file。
- `--no-open` 禁止自动打开浏览器。

### Web scripts

- `dev:web` 启动 Web UI 的 Vite dev server。
- `build:web` 对 Web UI 做 typecheck 并打包。
- `preview:web` 预览已构建的 Web UI。

### Test lanes

在修改现有行为或设计新行为之前，使用 `docs/testing-capability.md` 作为开发期测试设计契约。

- `test:api` 覆盖 runtime API contract。
- `test:server` 覆盖本地 HTTP server。
- `test:electron` 覆盖 Electron entry point、打包 asset resolution，以及 loopback-only embedded server contract。
- `test:gui` 通过系统 Chrome 和 CDP 覆盖完整浏览器流程。
- `test:docker` 运行 OpenCode、Codex、OpenClaw 和 Claude Code Docker validation lanes。
- `npm test` 运行完整测试套件，包括 Electron、Web UI 和聚合 Docker lanes。

### GUI flow

- `Init` 把 Gist ID 存入本地状态。
- `Remember GitHub Token` 把 GitHub Token 以明文保存在本地，并且 UI 只暴露 saved/not-saved 状态。
- `Pull` 获取 `agentcfg.yaml` 并刷新缓存。
- Dashboard 显示 state、cache 和 remote metadata。
- `Config file` 允许你选择 Codex、OpenCode、OpenClaw 或 Claude Code，并在编辑或应用更改前查看原始 native config file。
- `Diff` 显示单个 agent 或所有 agents 的 managed-field changes，包括 provider API key values。
- `Dry-run` 显示计划但不写入文件，包括每个计划文件的当前内容和 apply 后内容。
- `Apply` 要求输入 `APPLY`，再次验证，写入 backups，并显示 backup paths 和结果摘要。

Web UI 和本地 runtime API 会在远端表单、缓存摘要、diff/apply 摘要和文件预览中直接显示 provider API Key，使屏幕上的值与最终写入的值一致。保存的 GitHub Token 不同：runtime API 响应只暴露 token 是否已保存，永远不会暴露保存的 token 值。

## Setup

在 `agentcfg/` 目录中运行：

```sh
PATH="/opt/homebrew/bin:$PATH" npm install
PATH="/opt/homebrew/bin:$PATH" npm run build
PATH="/opt/homebrew/bin:$PATH" npm test
PATH="/opt/homebrew/bin:$PATH" npm run verify:privacy
PATH="/opt/homebrew/bin:$PATH" npm run test:docker
```

`npm run verify:privacy` 会确认 `.agentcfg-state.json` 和 `secrets.json` 已被 ignore、未 staged、未 tracked，并且没有按文件名出现在 git history 中。它不会读取私密文件内容。

## Commands

### `agentcfg init --gist <gist-id>`

把 Gist ID 存入本地状态。

使用 `--state <path>` 可以写入 `~/.agentcfg/state.json` 以外的位置。

### `agentcfg pull`

获取 `agentcfg.yaml`，验证它，并刷新本地缓存。

`pull` 不会写入原生 agent config files。

### `agentcfg diff`

只显示已掩码的 managed-field differences。

必须且只能使用一个 target selector：

- `--agent <codex|opencode|openclaw|claude>`
- `--all-agents`

常用 flags：

- `--state <path>` 选择本地 state file。
- `--config-path <path>` 指向一个 native config file 或 directory。
- `--fixtures-root <path>` 仅用于测试，指向 fixture roots。

`diff` 不写入任何内容。

### `agentcfg apply --dry-run`

验证选中的 agent configs，并打印计划中的更改，不写入文件。

### `agentcfg apply --yes`

验证后应用选中的 agent configs。

使用与 `diff` 相同的 target selector 和 path flags。

`apply` 会在写入前创建 backups，进行原子写入，并且除非设置 `--yes`，否则会要求确认。

### `agentcfg web`

默认在 `127.0.0.1:8787` 启动本地 Web UI。

使用 `--host`、`--port`、`--state` 和 `--no-open` 来匹配你的本地环境。默认 host 仅限 loopback。如果显式绑定到非 loopback 地址，agentcfg 会打印 trusted-network warning，而不是阻止 bind。

## Adapter behavior

### Codex

Codex 使用 TOML 作为 native config，并在 `~/.agentcfg/env/codex.env` 生成 env file。

env file 存储 secret，agentcfg 会用受限权限写入它。

Codex 没有官方 native per-model field 来表示 `variant`、`contextWindow`、`contextTokens` 或 `maxTokens`，因此 agentcfg 不会把这些 metadata fields 写入 Codex config。当选中的 canonical model 包含 `contextWindow`、`contextTokens` 或 `maxTokens` 时，diff、dry-run 和 apply 输出会显示 non-fatal notices，说明这些字段不受支持且未被写入。

### OpenCode

OpenCode 使用 JSON 或 JSONC。

agentcfg 会更新 top-level `model`，以及所选 provider 的 `options` 字段中的 `baseURL` 和 `apiKey`。

当选中的 canonical model 同时包含 `contextWindow` 和 `maxTokens` 时，agentcfg 会把它们写入官方 OpenCode model override：`provider.<id>.models.<model>.limit.context` 和 `limit.output`。如果存在 `contextTokens`，agentcfg 也会把它写入官方可选字段 `limit.input`。如果缺少 `contextWindow` 或 `maxTokens` 中任意一个，则跳过 `limit`，因为 OpenCode 要求两个 native fields 同时存在。`variant` 不会写入 OpenCode。

### OpenClaw

OpenClaw 使用 JSON5。

agentcfg 会更新 nested provider/default model fields，以及 `models.providers` 下的所选 provider entry。

对于选中的 canonical model，agentcfg 会在字段存在时，把官方 OpenClaw model metadata 写为 `models.providers.<provider>.models[]`，包含 `id`、`contextWindow`、`contextTokens` 和 `maxTokens`。`variant` 不会写入 OpenClaw。

### Claude Code

Claude Code 使用 `settings.json`。

agentcfg 会更新 Anthropic-compatible Claude Code settings 中的所选 model 和 provider environment variables，同时按结构保留无关设置。

## Managed and unmanaged fields

Managed fields 来自 Gist，并替换 active provider 的 native values。

Unmanaged fields 会按结构保留。这意味着 agentcfg 会保留无关 native settings，但当文件被重写时，不承诺逐字节保留格式或注释。

如果 adapter 在 managed path 中遇到 unsupported includes、interpolation 或含糊的 native shape，它会 fail closed，而不是猜测。

## Backups and rollback

每次写入前，agentcfg 都会创建 backup，然后原子写入新文件。

如果验证失败，不会写入任何内容。

如果需要回滚，恢复该文件最新的 backup。

包含 secret 的输出，例如 `~/.agentcfg/env/codex.env`，会使用受限权限写入，通常是 `0600`。

## Docker validation

`PATH="/opt/homebrew/bin:$PATH" npm run test:docker` 会运行所有 Docker validation lanes：

- `test:docker:opencode` 在 Docker 和 upstream image 可用时检查生成的 OpenCode config。
- `test:docker:codex` 先在本地检查 Codex TOML/env shape，然后在 Codex image 可用时运行 best-available bounded container smoke。
- `test:docker:openclaw` 在可用时使用 OpenClaw container validation command 检查生成的 OpenClaw config。
- `test:docker:claude` 在本地检查 Claude Code `settings.json`，并在可用时运行安全的 Claude CLI version smoke。

Codex 没有已确认的 upstream full config validator；Codex lane 覆盖 TOML/env shape 加 best-available container/policy smoke，不应被视为等同于完整官方 config validator。

如果 Docker、image 或 upstream validator 不可用，Docker script 可能会以 `SKIP: Docker/<Agent> validation unavailable` 消息正常退出。这个 skip 对本地开发是可接受的。

设置 `AGENTCFG_DOCKER_OPENCODE_STRICT=1`、`AGENTCFG_DOCKER_CODEX_STRICT=1`、`AGENTCFG_DOCKER_OPENCLAW_STRICT=1` 或 `AGENTCFG_DOCKER_CLAUDE_STRICT=1`，可以把对应的 documented skip 转换为 exit `77`，用于 release gating。

## Non-goals

MVP 不包含：

- encryption
- per-device profiles
- daemon、watch 或 background sync
- automatic model discovery
- provider API key validation
- secret rotation
- agent installation management
- every-agent support
