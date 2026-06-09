import test from "node:test";
import assert from "node:assert/strict";
import { formatNoPartnershipsMessage } from "@/lib/ai/partnership-research";

test("formatNoPartnershipsMessage when evidence exists", () => {
  const msg = formatNoPartnershipsMessage({
    research_backend: "legacy",
    source_url_count: 2,
    evidence_count: 5,
  });
  assert.match(msg, /5 web sources/);
});
