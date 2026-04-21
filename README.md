# swarp

**Agent orchestration for Claude Code.** Deploy remote Claude agents on Fly Sprites, orchestrated through a central gRPC router you own.

> This repository hosts the Claude Code plugin and signed release binaries. Source lives in a private monorepo.

🌐 https://swarp.dev

---

## What you get

- **Router** — gRPC server you deploy to Fly.io. Agents open long-lived bidi streams to it; your local Claude Code session dispatches tasks through it.
- **Runner** — the binary that lives on every agent sprite. Connects to the router, executes Claude sessions, and self-updates from this repo.
- **Slack** — optional bridge that lets a Slack workspace trigger agents.
- **Claude Code plugin** — MCP server, onboarding flow, deploy tooling, and agent YAML generator. Distributed from this repo as a Claude Code plugin.

All three binaries are statically-linked Go (no runtime deps), signed with ed25519, and downloadable unauthenticated from [Releases](https://github.com/dl3consulting/swarp/releases).

---

## Prerequisites

Before you start, install and authenticate:

| Tool | Install | Auth |
|------|---------|------|
| **Claude Code** | https://claude.com/claude-code | `claude login` |
| **flyctl** | `curl -L https://fly.io/install.sh \| sh` | `fly auth login` |
| **sprite** | `curl -fsSL https://sprites.dev/install.sh \| sh` | `sprite auth login` |
| **gh** | https://cli.github.com | `gh auth login` |

Fly.io account on any paid plan (router is ~$2/mo at the default 256MB shared CPU).

---

## Install

### Claude Code plugin (recommended)

```bash
claude plugins marketplace add dl3consulting/swarp
claude plugins install swarp@swarp
```

Restart Claude Code. Type `/swarp` in any session to start onboarding.

To update:

```bash
claude plugins update swarp@swarp
```

---

## Quickstart — your first agent in ~10 minutes

### 1. Onboard (one time, ~5 min)

In Claude Code:

```
/swarp
```

The skill walks you through four phases, prompting for decisions at each step:

1. **Prerequisites** — verifies flyctl, sprite, gh are installed and authenticated.
2. **Router** — deploys the gRPC router to your Fly.io org. Shows a cost estimate (~$2/mo) and waits for approval before creating infrastructure.
3. **Secrets** — guides you through setting the GitHub + Fly API tokens that CI and the deploy flow need.
4. **First agent** — creates an agent config.

At the end you'll have a `.swarp.json` in your repo root with the router URL and org config, plus whatever agent you created in step 4.

### 2. Provision a second agent

Agent configs live in `apps/swarp/agents/<name>/`. For each agent:

- `agent.yaml` — committed. Describes the persona and the modes the agent can run.
- `.env` — gitignored. Holds the agent's `CLAUDE_CODE_OAUTH_TOKEN` + `GH_TOKEN`.

Minimal `agent.yaml`:

```yaml
name: dominic
version: '1.0.0'
grpc_port: 50052
router_url: '${SWARP_ROUTER_URL}'

preamble: |
  You are Dominic Vargas, a no-nonsense backend engineer. Respond
  concisely, like a senior engineer in Slack.

modes:
  - name: chat
    description: 'Social conversation using persona'
    model: claude-haiku-4-5-20251001
    max_turns: 1
    timeout_minutes: 2
    prompt: |
      You are Dominic Vargas. Respond to: {{ message }}
      One or two sentences. {"response":"<your reply>"}
    allowed_tools: []

env:
  secrets:
    - GH_TOKEN
    - CLAUDE_CODE_OAUTH_TOKEN
  network:
    internet: true
```

Then provision:

```bash
./apps/swarp/agents/provision.sh dominic
```

The script is idempotent — safe to re-run. It creates the sprite, injects secrets, writes Claude credentials, installs the runner binary, sets up the WireGuard tunnel to the router, pushes `agent.yaml`, and starts the runner. Takes about 90 seconds.

### 3. Send the agent a task

From Claude Code, once the agent is connected:

```
> Send Dominic a chat message: "What did you break this morning?"
```

The MCP server turns that into a gRPC dispatch to your router, which routes it to dominic's runner, which runs a real Claude session with the persona prompt.

Or skip the conversational layer and dispatch directly:

```bash
node apps/swarp/npm/scripts/run-dispatch.mjs dominic chat "message=what did you break this morning?"
```

---

## Troubleshooting

### `dispatch failed: ... 5 NOT_FOUND`

The agent isn't connected to the router.

```bash
# Check what the router sees
/swarp status

# If the agent is offline, re-provision:
./apps/swarp/agents/provision.sh <agent>

# Or restart the runner manually:
sprite -s <agent> exec sh -- -c '
  pkill -x swarp-runner
  setsid nohup /home/sprite/start-runner.sh > /home/sprite/swarp-runner.log 2>&1 < /dev/null &
'
sprite -s <agent> exec tail /home/sprite/swarp-runner.log
```

### `dispatch failed: ... 14 UNAVAILABLE`

The sprite can't reach the router over the private net. Check the wireguard tunnel:

```bash
sprite -s <agent> exec ip addr show wg0
# If wg0 is missing or down:
./apps/swarp/agents/provision.sh <agent>   # re-establishes the peer
```

### `dispatch failed: ... 8 RESOURCE_EXHAUSTED`

The agent is already handling a task. Wait, or cancel. If it's been stuck more than a few minutes, the router's in-flight task tracking may be wedged — `fly machine restart <router-id> --app swarp-router` clears it.

### `Not logged in · Please run /login` on the agent

Claude auth didn't land on the sprite. Re-run the provision script — it writes `~/.claude/.credentials.json` idempotently from the OAuth token in `agents/<name>/.env`.

### flyctl wireguard create hangs

Delete any stale local config file first:

```bash
rm -f /tmp/<agent>.conf
flyctl wireguard create dl3-consulting dfw <agent> /tmp/<agent>.conf --debug
```

`--debug` surfaces real errors in under a second; without it, flyctl can retry-loop silently.

### wg-quick fails with `resolvconf: command not found`

Strip the `DNS =` line from the generated `.conf` before pushing to the sprite. The current Ubuntu sprite image doesn't ship `resolvconf`. `provision.sh` already handles this.

---

## Binary signature verification

Every `swarp-runner-*` artifact ships with a corresponding `.sig` file containing an ed25519 signature over the binary contents. The runner verifies its own updates; you can verify manually too:

```bash
curl -fsSL -O https://github.com/dl3consulting/swarp/releases/latest/download/swarp-runner-amd64
curl -fsSL -O https://github.com/dl3consulting/swarp/releases/latest/download/swarp-runner-amd64.sig
```

The public key is embedded in the runner binary itself at build time, so self-update rejects tampered releases without any external key distribution.

---

## Layout of a release

Each `v0.x.y` release on this repo contains:

| File | What |
|------|------|
| `swarp-router-{amd64,arm64}` | Router binary (you deploy this to Fly.io) |
| `swarp-runner-{amd64,arm64}` | Runner binary (lives on agent sprites) |
| `swarp-runner-{amd64,arm64}.sig` | ed25519 signature for the runner |
| `swarp-slack-{amd64,arm64}` | Slack bridge binary |

The CLI + MCP server are distributed as a Claude Code plugin from this repo (also published as `@swarp/cli` on npm).

---

## Security

- Source lives in a private monorepo. This repo hosts the built plugin files and unauthenticated-downloadable release artifacts so sprites anywhere on the public internet can self-update.
- GitHub Actions is **disabled** on this repo. There is no workflow attack surface. Releases are pushed by a scoped PAT from the source-of-truth monorepo's CI.
- Tag protection prevents `v*` tag deletion, update, and force-push.
- Branch protection requires PR review on `main`.

Found a vulnerability? Email andrew@kunzel.io (please don't open a public issue).

---

## License

All rights reserved. See [swarp.dev](https://swarp.dev) for terms of use.
