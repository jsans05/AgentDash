import assert from "node:assert/strict";
import test from "node:test";
import {
  pickBestInstagramHandle,
  pickBestSocialLinks,
  scoreInstagramHandle,
} from "./resolve-social.js";

test("scoreInstagramHandle prefers brand handle over partner accounts", () => {
  assert.ok(scoreInstagramHandle("pirelli", "Pirelli") > scoreInstagramHandle("astonmartinf1", "Pirelli"));
});

test("pickBestInstagramHandle selects pirelli for Pirelli brand", () => {
  const handle = pickBestInstagramHandle(["astonmartinf1", "pirelli", "pirellimotorsport"], "Pirelli");
  assert.equal(handle, "pirelli");
});

test("pickBestSocialLinks ignores unrelated instagram handles", () => {
  const social = pickBestSocialLinks("Pirelli", {
    instagram_url: "https://www.instagram.com/astonmartinf1/",
  }, {
    instagram_url: "https://www.instagram.com/pirelli/",
  });
  assert.equal(social.instagram_handle, "pirelli");
});
