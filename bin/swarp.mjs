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

async function main() {
  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(0);
  }

  if (cmd === 'init') {
    await runInit();
    return;
  }

  if (cmd === 'serve') {
    await startMcpServer();
    return;
  }

  if (cmd === 'generate') {
    const agentsDir = rest[0] || 'agents';
    await generateRunnerConfig(agentsDir);

    // Regenerate SKILL.md from current agent configs
    const { generateSkill } = await import('../src/skill/generate.mjs');
    const { resolve, join } = await import('node:path');
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const routerUrl = config?.router_url || 'your-router.fly.dev:50051';
    const skillContent = generateSkill({ agentsDir: resolve(agentsDir), routerUrl });
    const skillPath = join(process.cwd(), '.claude', 'skills', 'swarp', 'SKILL.md');
    mkdirSync(join(process.cwd(), '.claude', 'skills', 'swarp'), { recursive: true });
    writeFileSync(skillPath, skillContent, 'utf8');
    console.log(`Updated ${skillPath}`);
    return;
  }

  if (cmd === 'audit') {
    const agentsDir = rest[0] || 'agents';
    const results = await auditConfigs(agentsDir);
    let hasErrors = false;
    for (const result of results) {
      console.log(`\n=== ${result.agent} ===`);
      for (const c of result.checks) {
        const icon = c.status === 'pass' ? '\u2713' : c.status === 'fail' ? '\u2717' : '\u25cb';
        const sev = c.severity === 'error' ? 'ERR' : 'WRN';
        console.log(`  ${icon} [${sev}] ${c.name}: ${c.message}`);
        if (c.status === 'fail' && c.severity === 'error') hasErrors = true;
      }
    }
    console.log(`\nAudited ${results.length} agent(s).`);
    process.exit(hasErrors ? 1 : 0);
  }

  if (cmd === 'certs') {
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

  if (cmd === 'deploy') {
    const token = process.env.SWARP_SPRITES_TOKEN;
    if (!token) {
      console.error('Error: SWARP_SPRITES_TOKEN env var is required for deploy');
      process.exit(1);
    }

    const config = loadConfig('.swarp.json');
    const adapter = new FlySpriteAdapter(token);

    if (rest[0] === '--all') {
      const { auditConfigs } = await import('../src/generator/audit.mjs');
      const { readFileSync, readdirSync, existsSync } = await import('node:fs');
      const { resolve, join } = await import('node:path');
      const yaml = (await import('js-yaml')).default;

      const agentsDir = resolve(config.agents_dir || 'agents');
      const entries = readdirSync(agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const yamlPath = join(agentsDir, entry.name, 'agent.yaml');
        if (!existsSync(yamlPath)) continue;
        const agentConfig = yaml.load(readFileSync(yamlPath, 'utf-8'));
        console.log(`Deploying ${agentConfig.name}...`);
        await adapter.createAgent(agentConfig.name, agentConfig);
        console.log(`  Done: ${agentConfig.name}`);
      }
      return;
    }

    const agentName = rest[0];
    if (!agentName) {
      console.error('Error: deploy requires an agent name or --all');
      process.exit(1);
    }

    const { readFileSync, existsSync } = await import('node:fs');
    const { resolve, join } = await import('node:path');
    const yaml = (await import('js-yaml')).default;

    const agentsDir = resolve(config.agents_dir || 'agents');
    const yamlPath = join(agentsDir, agentName, 'agent.yaml');
    if (!existsSync(yamlPath)) {
      console.error(`Error: agent.yaml not found at ${yamlPath}`);
      process.exit(1);
    }
    const agentConfig = yaml.load(readFileSync(yamlPath, 'utf-8'));
    console.log(`Deploying ${agentName}...`);
    await adapter.createAgent(agentName, agentConfig);
    console.log(`  Done: ${agentName}`);
    return;
  }

  if (cmd === 'status') {
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
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
