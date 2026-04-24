#!/usr/bin/env node
import { runInit } from '../src/init/index.mjs';
import { auditConfigs } from '../src/generator/audit.mjs';
import { generateRunnerConfig } from '../src/generator/generate.mjs';
import { FlySpriteAdapter } from '../src/runtimes/fly-sprites.mjs';
import { loadConfig } from '../src/config.mjs';
import { startMcpServer } from '../src/mcp-server/index.mjs';

const args = process.argv.slice(2);
const [cmd, ...rest] = args;

function usage() {
  console.log(`Usage: swarp <command> [options]

Commands:
  init                    Initialize a new SWARP project
  serve                   Start the MCP server (stdio transport)
  generate [agents-dir]   Generate runner configs from agent.yaml files
  audit [agents-dir]      Audit agent.yaml files for schema errors
  certs generate          Generate mTLS CA, router, and agent keypairs
  certs rotate <name>     Rotate cert for a named agent
  deploy <agent>          Deploy a specific agent sprite
  deploy --all            Deploy all agents
  status [agent]          Show agent status via gRPC

Environment variables:
  SWARP_SPRITES_TOKEN     Required for deploy commands
`);
}

async function cmdInit() {
  await runInit();
}

async function cmdServe() {
  await startMcpServer();
}

async function cmdGenerate(rest) {
  const agentsDir = rest[0] || 'agents';
  await generateRunnerConfig(agentsDir);
}

async function cmdAudit(rest) {
  const agentsDir = rest[0] || 'agents';
  const results = await auditConfigs(agentsDir);
  let hasErrors = false;
  for (const result of results) {
    console.log(`\n=== ${result.agent} ===`);
    for (const c of result.checks) {
      const icon = c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '○';
      const sev = c.severity === 'error' ? 'ERR' : 'WRN';
      console.log(`  ${icon} [${sev}] ${c.name}: ${c.message}`);
      if (c.status === 'fail' && c.severity === 'error') hasErrors = true;
    }
  }
  console.log(`\nAudited ${results.length} agent(s).`);
  process.exit(hasErrors ? 1 : 0);
}

async function cmdCerts(rest) {
  const [subCmd, ...certArgs] = rest;
  if (subCmd === 'generate') {
    const { generateCerts } = await import('../src/certs/generate.mjs');
    await generateCerts(certArgs[0] || 'certs');
    return;
  }
  if (subCmd === 'rotate') {
    const name = certArgs[0];
    if (!name) {
      console.error('Error: certs rotate requires an agent name');
      process.exit(1);
    }
    const { rotateCert } = await import('../src/certs/generate.mjs');
    await rotateCert(name, certArgs[1] || 'certs');
    return;
  }
  console.error(`Unknown certs subcommand: ${subCmd}`);
  usage();
  process.exit(1);
}

async function cmdDeploy(rest) {
  const token = process.env.SWARP_SPRITES_TOKEN;
  if (!token) {
    console.error('Error: SWARP_SPRITES_TOKEN env var is required for deploy');
    process.exit(1);
  }

  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { resolve, join } = await import('node:path');
  const yaml = (await import('js-yaml')).default;

  const config = loadConfig('.swarp.json');
  const adapter = new FlySpriteAdapter(token);
  const agentsDir = resolve(config.agents_dir || 'agents');

  async function deployOne(name) {
    const yamlPath = join(agentsDir, name, 'agent.yaml');
    if (!existsSync(yamlPath)) {
      console.error(`Error: agent.yaml not found at ${yamlPath}`);
      process.exit(1);
    }
    const agentConfig = yaml.load(readFileSync(yamlPath, 'utf-8'));
    console.log(`Deploying ${agentConfig.name}...`);
    await adapter.createAgent(agentConfig.name, agentConfig);
    console.log(`  Done: ${agentConfig.name}`);
  }

  if (rest[0] === '--all') {
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(agentsDir, entry.name, 'agent.yaml'))) continue;
      await deployOne(entry.name);
    }
    return;
  }

  if (!rest[0]) {
    console.error('Error: deploy requires an agent name or --all');
    process.exit(1);
  }
  await deployOne(rest[0]);
}

async function cmdStatus(rest) {
  const config = loadConfig('.swarp.json');
  const { DispatchClient } = await import('../src/mcp-server/dispatch.mjs');
  const client = new DispatchClient(config.router_url);

  const agentName = rest[0];
  if (agentName) {
    const status = await client.getAgentStatus(agentName);
    console.log(JSON.stringify(status, null, 2));
  } else {
    const { agents } = await client.listAgents();
    for (const agent of agents) {
      const onlineStr = agent.online ? 'online' : 'offline';
      console.log(`${agent.name} (${onlineStr}) — ${agent.modes?.length ?? 0} mode(s)`);
    }
  }
}

const commands = {
  init: cmdInit,
  serve: cmdServe,
  generate: cmdGenerate,
  audit: cmdAudit,
  certs: cmdCerts,
  deploy: cmdDeploy,
  status: cmdStatus,
};

async function main() {
  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(0);
  }

  const handler = commands[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    usage();
    process.exit(1);
  }

  await handler(rest);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
