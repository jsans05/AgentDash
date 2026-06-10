import fs from "fs";
import path from "path";

const dir = "lib/ai/prompts";

function writePromptModule(name, exportName, params, raw) {
  const escaped = raw.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  let body = `return \`${escaped}\`;`;
  body = body
    .replace(/\\\$\{role\}/g, "${role}")
    .replace(/\\\$\{senderDisplayName\}/g, "${senderDisplayName}")
    .replace(/\\\$\{sportsListNumbered\}/g, "${sportsListNumbered}");

  const paramSig = params.join(", ");
  const ts = `export function ${exportName}(${paramSig}): string {\n  ${body}\n}\n`;
  fs.writeFileSync(path.join(dir, `${name}.ts`), ts);
}

const base = fs.readFileSync(path.join(dir, "base.txt"), "utf8");
const inbound = fs.readFileSync(path.join(dir, "inbound.txt"), "utf8");
const outbound = fs.readFileSync(path.join(dir, "outbound.txt"), "utf8");
const email = fs.readFileSync(path.join(dir, "email.txt"), "utf8");
const bulkImport = fs.readFileSync(path.join(dir, "bulkImport.txt"), "utf8");
const sharedRules = fs.readFileSync(path.join(dir, "sharedRules.txt"), "utf8");

writePromptModule("base", "getBasePrompt", ["role: string"], base);
writePromptModule("inbound", "getInboundPrompt", ["sportsListNumbered: string"], inbound);
writePromptModule("outbound", "getOutboundPrompt", [], outbound);
writePromptModule("email", "getEmailPrompt", ["senderDisplayName: string"], email);
writePromptModule("bulk-import", "getBulkImportPrompt", [], bulkImport);
writePromptModule("shared-rules", "getSharedRulesPrompt", [], sharedRules);

console.log("Generated TS prompt modules");
