/**
 * Hackathon TypeScript Agent Template
 *
 * Builds from Dockerfile with:
 * - Node.js 20 runtime
 * - Claude Code CLI
 * - Claude Agent SDK for TypeScript
 * - Agent code at /app/agent.mts
 * - Claude Code credentials at ~/.claude/.credentials.json
 *
 * Usage:
 *   pnpm --filter hackathon-agent run build:template
 *
 * Prerequisites:
 *   pnpm install
 *   MORU_API_KEY set in root .env
 */

import path from "path";
import { fileURLToPath } from "url";
import { Template } from "@moru-ai/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function buildTemplate() {
  const templateAlias = "team-wooteco";

  console.log("=".repeat(50));
  console.log("Building Hackathon TypeScript Agent Template");
  console.log("=".repeat(50));
  console.log(`\nTemplate alias: ${templateAlias}\n`);

  const template = Template()
    .fromDockerfile(path.join(__dirname, "Dockerfile"))
    .setStartCmd("echo ok");

  const buildInfo = await Template.build(template, {
    alias: templateAlias,
    cpuCount: 2,
    memoryMB: 2048,
    fileContextPath: __dirname,
    onBuildLogs: (entry) => console.log(entry.message),
  });

  console.log();
  console.log("=".repeat(50));
  console.log("Build Complete!");
  console.log("=".repeat(50));
  console.log();
  console.log(`Template ID: ${buildInfo.templateId}`);
  console.log(`Alias: ${buildInfo.alias}`);
  console.log();
  console.log("Agent code at: /app/agent.mts");
  console.log("Credentials at: ~/.claude/.credentials.json");
  console.log();
  console.log(`Usage:`);
  console.log(`  const sbx = await Sandbox.create('${templateAlias}')`);
  console.log(`  await sbx.commands.run('cd /app && npx tsx agent.mts')`);
}

buildTemplate().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
