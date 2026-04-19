# swarp

**Agent orchestration for Claude Code.** Deploy remote Claude agents on Fly Sprites, orchestrated through a central gRPC router you own.

> This repository hosts the signed public release artifacts. Source lives in a private monorepo. Releases here include the `router`, `runner`, and `slack` binaries for Linux (amd64 + arm64) along with their ed25519 signatures.

🌐 https://swarp.dev

---

## What you get

- **Router** — gRPC server that you deploy to Fly.io. Agents open long-lived bidi streams to it; your local Claude Code session dispatches tasks through it.
- **Runner** — the binary that lives on every agent sprite. Connects to the router, executes Claude sessions, and self-updates from this repo.
- **Slack** — optional bridge that lets a Slack workspace trigger agents.
- **`@swarp/cli` npm package** — the Claude Code MCP server, onboarding flow, deploy tooling, and agent YAML generator. Published to public npm on every release.

All three binaries are statically-linked Go (no runtime deps), signed with ed25519, and downloadable unauthenticated from [Releases](https://github.com/dl3consulting/swarp/releases).

---

## Install

### Option 1 — Claude Code plugin (recommended)

```bash
claude plugin add swarp
```

Then restart Claude Code. Type `/swarp` in any session to start onboarding. This installs the MCP server, skills, and hooks.

### Option 2 — npm directly

```bash
npm install -g @swarp/cli
swarp --help
```

### Option 3 — Runner binary (for sprites)

Sprites bootstrap a runner binary automatically during `swarm_deploy`, but you can also fetch it directly:

```bash
# linux/amd64
curl -fsSL \
  https://github.com/dl3consulting/swarp/releases/latest/download/swarp-runner-amd64 \
  -o swarp-runner
chmod +x swarp-runner

# linux/arm64
curl -fsSL \
  https://github.com/dl3consulting/swarp/releases/latest/download/swarp-runner-arm64 \
  -o swarp-runner
```

Once running, it self-updates on restart from the latest release in this repo (semver-major compatible, signature-verified).

---

## Quick start

```bash
# 1. Sign in at swarp.dev (OAuth)
claude
> /swarp

# The /swarp skill walks you through 4 phases:
#   1. Prerequisites — flyctl, sprite, gh CLIs
#   2. Router — deploy the gRPC router to your Fly.io org (~$2/mo)
#   3. Secrets — set GitHub + Fly API tokens
#   4. First agent — create agents/<name>/agent.yaml and deploy
```

Once an agent is deployed, dispatch tasks from Claude Code:

```
> Run a task on tess: write a blog post about Fly Sprites
```

The MCP server turns that into a gRPC call to your router, which routes it to the `tess` sprite's runner, which runs the task in a real Claude session with full tool access.

---

## Binary signature verification

Every `swarp-runner-*` artifact ships with a corresponding `.sig` file containing an ed25519 signature over the binary contents. The runner verifies its own updates; you can verify manually too:

```bash
# download binary + signature
curl -fsSL -O https://github.com/dl3consulting/swarp/releases/latest/download/swarp-runner-amd64
curl -fsSL -O https://github.com/dl3consulting/swarp/releases/latest/download/swarp-runner-amd64.sig

# verify (replace <hex-public-key> with the SWARP release public key)
openssl pkeyutl -verify \
  -pubin -inkey <hex-public-key>.pem \
  -rawin -in swarp-runner-amd64 \
  -sigfile swarp-runner-amd64.sig
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

The CLI + MCP server are published separately as `@swarp/cli` on npm with the matching version.

---

## Security

- No code is committed here. Source lives in a private monorepo; this repo exists to host unauthenticated-downloadable release artifacts so sprites anywhere on the public internet can self-update.
- GitHub Actions is **disabled** on this repo. There is no workflow attack surface. Releases are pushed by a scoped PAT from the source-of-truth monorepo's CI.
- Tag protection prevents `v*` tag deletion, update, and force-push.
- Branch protection requires signed commits and PR review on `main`.

Found a vulnerability? Email andrew@kunzel.io (please don't open a public issue).

---

## License

All rights reserved. See [swarp.dev](https://swarp.dev) for terms of use.
