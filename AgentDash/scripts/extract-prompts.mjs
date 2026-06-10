import fs from "fs";

const lines = fs.readFileSync("app/api/ai/chat/route.ts", "utf8").split("\n");
const promptLines = lines.slice(362, 854);
let content = promptLines.join("\n");
if (content.startsWith("  return `")) content = content.slice("  return `".length);
if (content.endsWith("`;")) content = content.slice(0, -2);

const findSection = (label) => {
  const idx = content.indexOf(`━━━ ${label}`);
  return idx;
};

const iFlow1 = findSection("FLOW 1:");
const iFlow2 = findSection("FLOW 2:");
const iFlow3 = findSection("FLOW 3:");
const iEmailTree = findSection("EMAIL FLOW DECISION TREE");
const iFlow8 = findSection("FLOW 8: BULK IMPORT");
const iFlow8c = findSection("FLOW 8C:");
const iFlow8d = findSection("FLOW 8D:");
const iFlow9 = findSection("FLOW 9:");
const iRules = content.indexOf("RULES:\n- Never invent audience percentages");

const slice = (a, b) => content.slice(a, b).trim();

const sections = {
  base: slice(0, iFlow1),
  inbound: slice(iFlow1, iFlow2),
  outbound: [slice(iFlow2, iFlow3), slice(iFlow3, iEmailTree), slice(iFlow9, iRules)].join("\n\n"),
  email: [slice(iEmailTree, iFlow8), slice(iFlow8d, iFlow9)].join("\n\n"),
  bulkImport: [slice(iFlow8, iFlow8c), slice(iFlow8c, iFlow8d)].join("\n\n"),
  sharedRules: slice(iRules, content.length),
};

fs.mkdirSync("lib/ai/prompts", { recursive: true });

for (const [name, text] of Object.entries(sections)) {
  const outPath = `lib/ai/prompts/${name}.txt`;
  fs.writeFileSync(outPath, text);
  console.log(name, text.length);
}
