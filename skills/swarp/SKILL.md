---
name: swarp
description: Agent orchestration — setup, create agents, deploy, manage. Use when user says /swarp, asks about agents, wants to deploy or manage remote Claude agents.
---

# /swarp

SWARP deploys remote Claude agents on Fly Sprites, orchestrated through a central gRPC router.

## First Run

If the user runs `/swarp` or asks about setting up agents, call the `swarp_onboard` tool with no arguments. It will tell you the current setup status and what to do next. Follow its instructions exactly.

The onboard tool manages a 4-phase workflow:

1. **Prerequisites** — checks flyctl, sprite, gh CLIs are installed
2. **Router** — deploys the SWARP router to Fly.io (requires user cost approval)
3. **Secrets** — guides setting GitHub repo secrets for CI
4. **First Agent** — creates and deploys the first agent

Each phase must complete before the next can start. The tool enforces this — do not try to skip phases.

## Autonomy Principle

**Run commands directly. Do not ask the user to run things for you.** Claude Code's permission system is the gate — if a command needs approval, the user will be prompted automatically. For example:

- Missing CLI tools? Run the install command yourself.
- Need to authenticate? Run `fly auth login` yourself (Claude Code will handle the interactive prompt if needed, or the user will be prompted to approve).
- Need to verify credentials? Run `flyctl status` or `sprite list` yourself.
- Read-only commands like `flyctl orgs list` or `gh secret list`? Just run them.

Only stop to ask the user when you need **information** from them (e.g., "what should the agent do?"), not when you need to **execute** something.

## User Choices

When asking the user to make a decision (which org, which model, which mode), **always use AskUserQuestion** with structured options instead of asking in free text. Discover the options yourself first (e.g., run `flyctl orgs list` to find orgs), then present them as choices. This gives the user a clean click-to-select UI instead of making them type something they don't know off the top of their head.

## Commands

### `/swarp` (no arguments)

Call `swarp_onboard` with action `status`. Show the result to the user.

### `/swarp create <name>`

Help the user create an agent. Ask:

1. What should this agent do? (natural language description)
2. What model should it use? (suggest Haiku for fast/cheap, Sonnet for balanced, Opus for complex)
3. Any specific tools it should have access to?

Generate `agents/<name>/agent.yaml` with appropriate modes based on the answers. Use the Write tool to create the file.

### `/swarp deploy <name>`

Call the `swarp_deploy` MCP tool with the agent name. This triggers a cost confirmation prompt — the user must approve before infrastructure is created.

### `/swarp deploy --all`

Deploy all agents found in the agents directory. Call `swarp_deploy` for each one. Each triggers its own cost confirmation.

### `/swarp destroy <name>`

Call the `swarp_destroy` MCP tool with the agent name. This triggers a confirmation prompt warning about data loss.

### `/swarp status`

Call `swarp_status` MCP tool (no arguments for all agents, or with agent name for one).

## Agent YAML Format

When creating agents, generate YAML like this:

```yaml
name: <agent-name>
version: '1.0.0'
grpc_port: 50052
router_url: '${SWARP_ROUTER_URL}'

preamble: |
  <describe what the agent does and its personality>

modes:
  - name: <primary-mode>
    description: '<what this mode does>'
    model: <claude-sonnet-4-6 or claude-haiku-4-5-20251001>
    max_turns: <10-40 depending on complexity>
    timeout_minutes: <5-30>
    prompt: '{{ task }}'
    allowed_tools:
      - Read
      - Edit
      - Write
      - Bash
      - Glob
      - Grep
```

## Important Notes

- **Cost gates**: `swarp_deploy`, `swarp_deploy_router`, and `swarp_destroy` all trigger cost confirmation hooks. The user WILL be prompted by Claude Code before these execute. Set their expectations: "This will create infrastructure — you'll see a cost estimate and need to approve."
- **WireGuard**: Agent sprites connect to the router via WireGuard tunnels over Fly's private network. This is handled automatically during deploy.
- **OAuth**: External clients (like this Claude Code session) authenticate to the router via Supabase OAuth at swarp.dev. The MCP server handles the token automatically.
