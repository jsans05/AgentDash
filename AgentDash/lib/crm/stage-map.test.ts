import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FUNNEL_TO_PIPELINE,
  mergePipelineStages,
  normalizePipelineStage,
  pipelineStageFromFunnel,
  pipelineStageToFunnel,
} from "./stage-map";

describe("stage-map", () => {
  it("maps funnel to pipeline", () => {
    assert.equal(pipelineStageFromFunnel("idea"), "target");
    assert.equal(pipelineStageFromFunnel("contacted"), "outreach");
    assert.equal(pipelineStageFromFunnel("won"), "closed");
  });

  it("accepts funnel aliases in normalizePipelineStage", () => {
    assert.equal(normalizePipelineStage("negotiating"), "in_progress");
    assert.equal(normalizePipelineStage("outreach"), "outreach");
  });

  it("mergePipelineStages picks further progress", () => {
    assert.equal(mergePipelineStages("target", "outreach"), "outreach");
    assert.equal(mergePipelineStages("closed", "research"), "closed");
    assert.equal(normalizePipelineStage("research"), "target");
  });

  it("round-trips pipeline to funnel for legacy column", () => {
    assert.equal(pipelineStageToFunnel("drafting"), "research");
    assert.equal(pipelineStageToFunnel(FUNNEL_TO_PIPELINE.won), "won");
  });
});
