import assert from "node:assert/strict";
import test from "node:test";
import { industryCacheScope, mentionsCacheScope } from "../lib/collector-scopes";

const settings: Parameters<typeof industryCacheScope>[0] = {
  industry: {sources:[],keywords:["gardening"],description:"Local gardening news",excludedTerms:[],dailyLimit:30},
  mentions: {terms:["Example"],websites:[],identityAnchors:["Gardening"],negativeTerms:[],strictMode:true,excludeOwnedSites:true},
  ai: {provider:"none",model:"",localBaseUrls:{lmstudio:"http://127.0.0.1:1234",ollama:"http://127.0.0.1:11434"}},
};

test("AI mention cache changes with the reader's niche but keyless collection does not", () => {
  const other = {...settings,industry:{...settings.industry,description:"Commercial landscape suppliers"}};
  assert.equal(mentionsCacheScope(settings),mentionsCacheScope(other));
  assert.notEqual(mentionsCacheScope({...settings,ai:{...settings.ai,provider:"openai"}}),
    mentionsCacheScope({...other,ai:{...settings.ai,provider:"openai"}}));
});

test("changing the selected local runtime invalidates both saved AI response scopes", () => {
  const local = {...settings,ai:{...settings.ai,provider:"ollama" as const}};
  const changed = {...local,ai:{...local.ai,localBaseUrls:{lmstudio:"http://127.0.0.1:1234",ollama:"http://127.0.0.1:11435"}}};
  assert.notEqual(industryCacheScope(local),industryCacheScope(changed));
  assert.notEqual(mentionsCacheScope(local),mentionsCacheScope(changed));
});
