export type FlowModeEnforcement = "schema" | "advisory" | "off";

/** How strictly UI flow modes constrain tool schema and runtime guards. */
export function getFlowModeEnforcement(): FlowModeEnforcement {
  const raw = String(process.env.FLOW_MODE_ENFORCEMENT ?? "schema").toLowerCase();
  if (raw === "advisory" || raw === "off") return raw;
  return "schema";
}

// "schema": Phase 1–4 behavior — *_BLOCKED_TOOLS hide tools from the LLM. Mode is enforced.
// "advisory": Modes still appear in the system prompt as a hint, but tools are NOT filtered.
// "off": Mode is ignored entirely; tools are NOT filtered; no mode hint in the prompt.
