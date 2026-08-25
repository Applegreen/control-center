import assert from "node:assert/strict";
import test from "node:test";
import { extractGoogleNewsDecodeParameters, googleNewsArticleId, parseGoogleNewsBatchResponse } from "../lib/google-news";

test("Google News article IDs and decode parameters are extracted from the redirect page", () => {
  const url = "https://news.google.com/rss/articles/neutral-token?oc=5";
  const html = '<div data-n-a-ts="1787600000" data-n-a-id="neutral-token" data-n-a-sg="signed-value"></div>';
  assert.equal(googleNewsArticleId(url), "neutral-token");
  assert.deepEqual(extractGoogleNewsDecodeParameters(html, "neutral-token"), {
    articleId: "neutral-token",
    signature: "signed-value",
    timestamp: 1787600000,
  });
  assert.equal(googleNewsArticleId("https://example.com/rss/articles/neutral-token"), "");
});

test("Google News batch responses expose the canonical publisher URL", () => {
  const nested = JSON.stringify(["garturlres", "https://publisher.example/story", 1]);
  const response = `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", nested, null]])}`;
  assert.equal(parseGoogleNewsBatchResponse(response), "https://publisher.example/story");
  assert.equal(parseGoogleNewsBatchResponse("not a response"), "");
});
