import assert from "node:assert/strict";
import test from "node:test";
import { audienceGrowthFromSnapshot, combineAudienceChanges, nextAudienceSnapshot, parseAudienceSnapshots } from "../lib/audience-growth";
import {
  audienceAccountFingerprint,
  audienceCacheWindowMs,
  canonicalizePublicProfileUrl,
  cookieHeaderFromSetCookie,
  isValidPublicProfileUrl,
  linkedInHttpError,
  mergeCookieHeaders,
  parseFacebookPublicProfile,
  parseLinkedInPublicProfile,
  parseTikTokPublicProfile,
  parseThreadsPublicProfile,
  parseYouTubePublicProfile,
  publicProfileHandle,
  resolvePublicProfileUrl,
  samePublicProfileIdentity,
  sameHostRedirectSession,
} from "../lib/public-metrics";

test("automatic public checks use a short cache while LinkedIn uses a daily cache", () => {
  assert.equal(audienceCacheWindowMs("instagram"), 60 * 60 * 1000);
  assert.equal(audienceCacheWindowMs("youtube"), 60 * 60 * 1000);
  assert.equal(audienceCacheWindowMs("linkedin"), 24 * 60 * 60 * 1000);
});

test("audience growth persists follower deltas independently from content counts", () => {
  const first = nextAudienceSnapshot({
    total: 100,
    checkedAt: "2026-08-24T12:00:00Z",
    fingerprint: "youtube:northstar",
    primaryLabel: "subscribers",
    secondaryLabel: "videos",
    secondaryValue: 50,
  });
  const second = nextAudienceSnapshot({
    total: 112,
    checkedAt: "2026-08-25T12:00:00Z",
    fingerprint: "youtube:northstar",
    primaryLabel: "subscribers",
    secondaryLabel: "videos",
    secondaryValue: 51,
  }, first);

  assert.deepEqual(audienceGrowthFromSnapshot(first), {
    change: null,
    changeComparedAt: undefined,
  });
  assert.deepEqual(audienceGrowthFromSnapshot(second), {
    change: 12,
    changeComparedAt: "2026-08-24T12:00:00Z",
  });
  assert.equal(second.secondaryValue, 51);
  assert.equal(audienceGrowthFromSnapshot(second).change, 12);
  assert.deepEqual(combineAudienceChanges([{ change: null }, { change: null }]), {
    change: 0,
    comparisonCount: 0,
  });
  assert.deepEqual(combineAudienceChanges([{ change: 12 }, { change: -2 }, { change: null }]), {
    change: 10,
    comparisonCount: 2,
  });

  const changedMetric = nextAudienceSnapshot({
    total: 80,
    checkedAt: "2026-08-26T12:00:00Z",
    fingerprint: "facebook:northstar",
    primaryLabel: "page likes",
  }, {
    total: 112,
    checkedAt: "2026-08-25T12:00:00Z",
    fingerprint: "facebook:northstar",
    primaryLabel: "followers",
  });
  assert.deepEqual(audienceGrowthFromSnapshot(changedMetric), {
    change: null,
    changeComparedAt: undefined,
  });
});

test("malformed audience snapshot history fails closed", () => {
  assert.throws(() => parseAudienceSnapshots([]), /must be an object/i);
  assert.throws(
    () => parseAudienceSnapshots({ account: { total: "100", checkedAt: "today" } }),
    /entries are invalid/i,
  );
  assert.deepEqual(
    parseAudienceSnapshots({
      account: { total: 100, checkedAt: "2026-08-25T12:00:00Z" },
    }),
    { account: { total: 100, checkedAt: "2026-08-25T12:00:00Z" } },
  );
});

test("social profile validation accepts account URLs and rejects content URLs", () => {
  assert.equal(isValidPublicProfileUrl("x", "https://x.com/northstar/status/123"), false);
  assert.equal(isValidPublicProfileUrl("instagram", "https://www.instagram.com/p/POST123/"), false);
  assert.equal(isValidPublicProfileUrl("facebook", "https://www.facebook.com/watch/?v=123"), false);
  assert.equal(isValidPublicProfileUrl("linkedin", "https://www.linkedin.com/posts/example-post-123"), false);
  assert.equal(isValidPublicProfileUrl("linkedin", "https://www.linkedin.com/jobs/view/123"), false);
  assert.equal(isValidPublicProfileUrl("threads", "https://www.threads.com/@northstar/post/abc"), false);
  assert.equal(isValidPublicProfileUrl("tiktok", "https://www.tiktok.com/@northstar/video/123"), false);
  assert.equal(isValidPublicProfileUrl("youtube", "https://www.youtube.com/@northstar/shorts/abc"), false);

  assert.equal(canonicalizePublicProfileUrl("x", "https://twitter.com/NorthStar/?s=20"), "https://x.com/NorthStar");
  assert.equal(canonicalizePublicProfileUrl("instagram", "instagram.com/northstar?hl=en"), "https://www.instagram.com/northstar/");
  assert.equal(canonicalizePublicProfileUrl("facebook", "https://m.facebook.com/profile.php?id=12345&ref=bookmarks"), "https://www.facebook.com/profile.php?id=12345");
  assert.equal(canonicalizePublicProfileUrl("linkedin", "https://linkedin.com/company/northstar/posts/?feedView=all"), "https://www.linkedin.com/company/northstar/");
  assert.equal(canonicalizePublicProfileUrl("linkedin", "https://uk.linkedin.com/company/northstar/"), "https://www.linkedin.com/company/northstar/");
  assert.equal(canonicalizePublicProfileUrl("linkedin", "https://m.linkedin.com/in/alex-northstar/"), "https://www.linkedin.com/in/alex-northstar/");
  assert.equal(canonicalizePublicProfileUrl("linkedin", "https://uk.linkedin.com.evil.example/in/alex-northstar/"), null);
  assert.equal(canonicalizePublicProfileUrl("linkedin", "https://www.linkedin.com/in/alex-northstar/details/experience/"), "https://www.linkedin.com/in/alex-northstar/");
  assert.equal(canonicalizePublicProfileUrl("youtube", "https://m.youtube.com/@northstar/videos"), "https://www.youtube.com/@northstar");
  assert.equal(publicProfileHandle("linkedin", "https://linkedin.com/company/northstar/posts/"), "northstar");
  assert.equal(resolvePublicProfileUrl("x", "", "home"), "");
});

test("public page parsers use target-bound metadata instead of nearby account counts", () => {
  const youtube = `
    <aside>999M subscribers</aside>
    <script>var ytInitialData = {
      "header":{"pageHeaderRenderer":{"content":{"metadataRows":[{"metadataParts":[{"text":{"content":"123 subscribers"}},{"text":{"content":"8 videos"}}]}]}}},
      "metadata":{"channelMetadataRenderer":{"externalId":"UCAbC","vanityChannelUrl":"https://www.youtube.com/@northstar"}}
    };</script>
  `;
  assert.deepEqual(parseYouTubePublicProfile(youtube, "https://www.youtube.com/@northstar"), { subscribers: 123, videos: 8, rounded: false });
  assert.equal(parseYouTubePublicProfile(youtube.replace("@northstar", "@another"), "https://www.youtube.com/@northstar"), null);
  assert.equal(parseYouTubePublicProfile(youtube, "https://www.youtube.com/channel/UCabc"), null);

  const tiktok = `
    <aside>"followerCount":999000</aside>
    <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{
      "__DEFAULT_SCOPE__":{"webapp.user-detail":{"userInfo":{"user":{"uniqueId":"northstar"},"stats":{"followerCount":123,"videoCount":8}}}}
    }</script>
  `;
  assert.deepEqual(parseTikTokPublicProfile(tiktok, "https://www.tiktok.com/@northstar"), { followers: 123, videos: 8, handle: "northstar", rounded: false });
  assert.equal(parseTikTokPublicProfile(tiktok, "https://www.tiktok.com/@another"), null);

  const facebook = `
    <aside>999M followers</aside>
    <meta property="og:url" content="https://www.facebook.com/northstar/">
    <meta property="og:description" content="123 followers &bull; 45 likes">
  `;
  assert.deepEqual(parseFacebookPublicProfile(facebook, "https://www.facebook.com/northstar/"), { followers: 123, likes: 45, rounded: false });
  assert.equal(parseFacebookPublicProfile(facebook, "https://www.facebook.com/another/"), null);

  const threads = `
    <aside>999K Followers</aside>
    <meta property="og:url" content="https://www.threads.com/@northstar">
    <meta property="og:title" content="Northstar (@northstar) • Threads">
    <meta property="og:description" content="123 Followers &#x2022; 8 Threads">
  `;
  assert.deepEqual(parseThreadsPublicProfile(threads, "https://www.threads.com/@northstar"), { followers: 123, threads: 8 });
  assert.deepEqual(parseThreadsPublicProfile(threads, "https://www.threads.com/@another"), { followers: null, threads: null });
});

test("LinkedIn personal parsing is scoped to the target top card", () => {
  const html = `
    <meta property="og:url" content="https://www.linkedin.com/in/alex-northstar/">
    <section class="profile">
      <div class="not-first-middot"><span> 11K followers </span><span>500+ connections</span></div>
    </section>
    <aside><div>20K followers</div></aside>
  `;
  assert.deepEqual(parseLinkedInPublicProfile(html, "https://www.linkedin.com/in/alex-northstar/"), {
    followers: 11_000,
    kind: "personal",
    rounded: true,
  });
});

test("LinkedIn personal parsing never borrows a recommendation count", () => {
  const html = `
    <meta property="og:url" content="https://www.linkedin.com/in/alex-northstar/">
    <section class="profile"><div class="not-first-middot"><span>500+ connections</span></div></section>
    <aside><div>20K followers</div></aside>
  `;
  assert.deepEqual(parseLinkedInPublicProfile(html, "https://www.linkedin.com/in/alex-northstar/"), {
    followers: null,
    kind: "personal",
    rounded: false,
  });
});

test("LinkedIn organization parsing uses target Open Graph metadata", () => {
  const html = `
    <aside>727,601 followers</aside>
    <meta property="og:url" content="https://www.linkedin.com/company/northstar/">
    <meta content="Northstar | 28,944,424 followers on LinkedIn. Public company profile." property="og:description">
  `;
  assert.deepEqual(parseLinkedInPublicProfile(html, "https://www.linkedin.com/company/northstar/"), {
    followers: 28_944_424,
    kind: "organization",
    rounded: false,
  });
});

test("public page parsers reject counts without positive configured-target identity", () => {
  const youtubeWithoutIdentity = `<script>{"header":{"pageHeaderRenderer":{"text":"777 subscribers"}}}</script>`;
  assert.equal(parseYouTubePublicProfile(youtubeWithoutIdentity, "https://www.youtube.com/@northstar"), null);

  const facebookWithoutIdentity = `<meta property="og:description" content="777 followers">`;
  assert.equal(parseFacebookPublicProfile(facebookWithoutIdentity, "https://www.facebook.com/northstar/"), null);

  const threadsWithoutIdentity = `<meta property="og:description" content="777 Followers">`;
  assert.deepEqual(parseThreadsPublicProfile(threadsWithoutIdentity, "https://www.threads.com/@northstar"), { followers: null, threads: null });

  const tiktokWithoutIdentity = `<meta property="og:description" content="777 Followers, 12 Videos">`;
  assert.equal(parseTikTokPublicProfile(tiktokWithoutIdentity, "https://www.tiktok.com/@northstar"), null);

  const linkedInWithoutIdentity = `<div class="not-first-middot"><span>777 followers</span></div>`;
  assert.equal(parseLinkedInPublicProfile(linkedInWithoutIdentity, "https://www.linkedin.com/in/alex-northstar/"), null);
});

test("public page parsers reject mismatched configured-target metadata", () => {
  const youtube = `
    <link rel="canonical" href="https://www.youtube.com/@another">
    <script>{"header":{"pageHeaderRenderer":{"text":"777 subscribers"}}}</script>
  `;
  assert.equal(parseYouTubePublicProfile(youtube, "https://www.youtube.com/@northstar"), null);

  const facebook = `
    <meta property="og:url" content="https://www.facebook.com/another/">
    <meta property="og:description" content="777 followers">
  `;
  assert.equal(parseFacebookPublicProfile(facebook, "https://www.facebook.com/northstar/"), null);

  const threads = `
    <meta property="og:url" content="https://www.threads.com/@another">
    <meta property="og:title" content="Another (@another) • Threads">
    <meta property="og:description" content="777 Followers">
  `;
  assert.deepEqual(parseThreadsPublicProfile(threads, "https://www.threads.com/@northstar"), { followers: null, threads: null });

  const linkedIn = `
    <meta property="og:url" content="https://www.linkedin.com/in/another/">
    <div class="not-first-middot"><span>777 followers</span></div>
  `;
  assert.equal(parseLinkedInPublicProfile(linkedIn, "https://www.linkedin.com/in/alex-northstar/"), null);
});

test("anonymous LinkedIn redirect sessions forward only first-party cookies", () => {
  const setCookies = [
    'JSESSIONID="ajax:123"; Path=/; Secure; SameSite=None',
    'bcookie="v=2&abc"; Expires=Mon, 25 Aug 2026 12:00:00 GMT; Domain=.linkedin.com; Secure',
  ];
  assert.equal(cookieHeaderFromSetCookie(setCookies), 'JSESSIONID="ajax:123"; bcookie="v=2&abc"');
  assert.equal(mergeCookieHeaders("lang=v=2; JSESSIONID=old", 'JSESSIONID="ajax:123"; bcookie="v=2&abc"'), 'lang=v=2; JSESSIONID="ajax:123"; bcookie="v=2&abc"');

  assert.deepEqual(sameHostRedirectSession(
    "https://www.linkedin.com/in/alex-northstar/",
    "https://www.linkedin.com/in/alex-northstar",
    "",
    setCookies,
  ), {
    nextUrl: "https://www.linkedin.com/in/alex-northstar",
    cookieHeader: 'JSESSIONID="ajax:123"; bcookie="v=2&abc"',
  });
  assert.equal(sameHostRedirectSession(
    "https://www.linkedin.com/in/alex-northstar/",
    "https://example.com/profile",
    "",
    setCookies,
  ), null);
});

test("audience snapshots are tied to canonical account identity", () => {
  const base = { platform: "linkedin" as const, username: "", accountId: "" };
  const person = audienceAccountFingerprint({ ...base, profileUrl: "https://linkedin.com/in/alex-northstar/?trk=public_profile" });
  const samePerson = audienceAccountFingerprint({ ...base, profileUrl: "https://www.linkedin.com/in/alex-northstar" });
  const company = audienceAccountFingerprint({ ...base, profileUrl: "https://www.linkedin.com/company/alex-northstar/" });
  assert.equal(person, samePerson);
  assert.notEqual(person, company);
  assert.notEqual(company, audienceAccountFingerprint({ ...base, profileUrl: "https://www.linkedin.com/company/another-company/" }));

  const channelBase = { platform: "youtube" as const, username: "", accountId: "" };
  const uppercaseChannel = audienceAccountFingerprint({ ...channelBase, profileUrl: "https://www.youtube.com/channel/UCAbC" });
  const lowercaseChannel = audienceAccountFingerprint({ ...channelBase, profileUrl: "https://www.youtube.com/channel/UCabc" });
  assert.notEqual(uppercaseChannel, lowercaseChannel);
});

test("effective profile redirects must retain the configured account identity", () => {
  assert.equal(samePublicProfileIdentity(
    "linkedin",
    "https://www.linkedin.com/in/alex-northstar/",
    "https://www.linkedin.com/in/alex-northstar?trk=public_profile",
  ), true);
  assert.equal(samePublicProfileIdentity(
    "linkedin",
    "https://www.linkedin.com/in/alex-northstar/",
    "https://www.linkedin.com/authwall?trk=bf",
  ), false);
  assert.equal(samePublicProfileIdentity(
    "youtube",
    "https://www.youtube.com/@northstar",
    "https://www.youtube.com/@another",
  ), false);
  assert.equal(samePublicProfileIdentity(
    "facebook",
    "https://www.facebook.com/northstar/",
    "https://www.facebook.com/login/",
  ), false);
});

test("LinkedIn block responses produce a stable human-readable provider error", () => {
  const failure = linkedInHttpError(999);
  assert.equal(failure.code, "provider_blocked");
  assert.match(failure.message, /LinkedIn temporarily blocked this public profile check/);
  assert.doesNotMatch(failure.message, /999|HTTP/i);
});
