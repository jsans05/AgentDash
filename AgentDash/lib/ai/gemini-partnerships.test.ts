import test from "node:test";
import assert from "node:assert/strict";
import {
  citableUrlFromWebChunk,
  groundingChunksToHits,
  isGroundingRedirectUrl,
  matchSourceToEvidence,
  mentionsBrand,
} from "@/lib/ai/gemini-partnerships";

test("isGroundingRedirectUrl detects Vertex grounding redirects", () => {
  assert.equal(
    isGroundingRedirectUrl("https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc"),
    true
  );
  assert.equal(isGroundingRedirectUrl("https://www.directv.com/news"), false);
});

test("citableUrlFromWebChunk uses domain when uri is a redirect", () => {
  const url = citableUrlFromWebChunk({
    uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc",
    domain: "directv.com",
    title: "DIRECTV signs athlete ambassador",
  });
  assert.equal(url, "https://directv.com");
});

test("groundingChunksToHits skips non-partnership chunks", () => {
  const hits = groundingChunksToHits([
    {
      web: {
        uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/x",
        domain: "directv.com",
        title: "directv.com",
      },
    },
    {
      web: {
        uri: "https://example.com/post",
        title: "Brand announces multi-year athlete sponsorship",
        domain: "example.com",
      },
    },
  ]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.url, "https://example.com/post");
});

test("mentionsBrand matches CarHartt against Carhartt in text", () => {
  assert.equal(
    mentionsBrand("Carhartt tapped pro skater for brand ambassador program", "CarHartt"),
    true
  );
});

test("matchSourceToEvidence resolves numeric index and hostname", () => {
  const hits = [
    {
      url: "https://www.prnewswire.com/carhartt-deal",
      title: "Carhartt partnership",
      snippet: "sponsorship",
    },
  ];
  assert.equal(matchSourceToEvidence("1", hits), hits[0]!.url);
  assert.equal(matchSourceToEvidence("prnewswire.com", hits), hits[0]!.url);
});
