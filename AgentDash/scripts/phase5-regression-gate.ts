#!/usr/bin/env tsx
/**
 * Phase 5 regression gate helper — prints canonical B.1–B.6 prompts and telemetry fields to compare.
 * Run after prompt changes; execute prompts against dev server and compare turn_telemetry in ai_messages metadata.
 */
const PROMPTS = [
  { id: "B.1", text: "find sponsors for Griffin Colapinto", expect: "resolveAthletesByName → getSponsorshipTargets → generateAthleteProspectList" },
  { id: "B.2", text: "find athletes for Patagonia", expect: "getDistinctAudienceInterests → ask_user_question" },
  { id: "B.3", text: "draft email for Griffin to Nike", expect: "curatePitchInterests → composePitchEmail" },
  { id: "B.4", text: "draft emails to Nike, Adidas, and Puma for Griffin", expect: "composePitchEmail ×N → pushEmailToCrm" },
  { id: "B.5", turn1: "find sponsors for Griffin Colapinto", turn2: "draft an email to Nike", expect: "prospect then email pipeline" },
  { id: "B.6", text: "which athletes on our roster fit a fitness brand with Australian audience", expect: "searchRosterAthletes or inbound chain" },
];

const ACCEPTANCE = {
  median_iterations_lte: 3,
  zero_repeated_skip_corrections: true,
  cache_read_ratio_gt: 0.65,
  telemetry_fields: [
    "input_tokens",
    "output_tokens",
    "iterations",
    "corrections",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
    "cache_miss_reasons",
  ],
};

console.log("Phase 5 canonical prompts (flow_mode: auto, ui_context: global unless noted):\n");
for (const p of PROMPTS) {
  console.log(`${p.id}: ${"text" in p ? p.text : `${p.turn1} → ${p.turn2}`}`);
  console.log(`   expect: ${p.expect}\n`);
}
console.log("Acceptance thresholds:", JSON.stringify(ACCEPTANCE, null, 2));
console.log("\nCompare turn_telemetry before/after each remediation phase.");
