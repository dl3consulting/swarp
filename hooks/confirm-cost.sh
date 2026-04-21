#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ -z "$TOOL_NAME" ]; then
  jq -n '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"block","permissionDecisionReason":"Could not determine tool name."}}' >&2
  exit 1
fi

make_decision() {
  local decision="$1"
  local reason="$2"
  jq -n \
    --arg d "$decision" \
    --arg r "$reason" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":$d,"permissionDecisionReason":$r}}'
}

case "$TOOL_NAME" in
  *swarp_deploy_router)
    COST_INFO="Fly Machine (shared-cpu-1x, 256MB): ~\$1.94/mo + 1GB volume: ~\$0.15/mo + shared IPv4: \$0/mo. Total: ~\$2.09/mo."
    make_decision "ask" "This will create a Fly Machine + volume. $COST_INFO Billed to your Fly.io account."
    ;;

  *swarp_deploy)
    AGENT=$(echo "$INPUT" | jq -r '.tool_input.agent // "unknown"')
    make_decision "ask" "This will create a Fly Sprite for agent '$AGENT'. Sprites cost ~\$0.007/min while running (paused when idle). A typical 30-min session costs ~\$0.21. Billed to your Fly.io account."
    ;;

  *swarp_destroy)
    AGENT=$(echo "$INPUT" | jq -r '.tool_input.agent // "unknown"')
    make_decision "ask" "This will PERMANENTLY destroy the sprite for agent '$AGENT'. Lost: runner process state, session files on sprite. Agent config (agent.yaml) is preserved locally. This cannot be undone."
    ;;

  *)
    make_decision "ask" "Unknown destructive action: $TOOL_NAME. Proceed with caution."
    ;;
esac
