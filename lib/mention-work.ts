export const MAX_MENTION_IDENTITIES = 12;
export const MAX_MENTION_CONTEXT_VALUES = 24;
export const MAX_MENTION_VALUE_LENGTH = 200;
export const MENTION_SEARCH_CONCURRENCY = 6;
export const MENTION_AI_CONCURRENCY = 2;

export function cleanBoundedMentionValues(
  values: string[],
  label: string,
  maxItems: number,
) {
  if (!Array.isArray(values)) throw new Error(`${label} must be a list.`);
  const cleaned = [...new Set(values.map((value) => {
    if (typeof value !== "string") throw new Error(`${label} must contain text values only.`);
    const candidate = value.trim();
    if (candidate.length > MAX_MENTION_VALUE_LENGTH) {
      throw new Error(
        `${label} entries must be ${MAX_MENTION_VALUE_LENGTH} characters or fewer.`,
      );
    }
    return candidate;
  }).filter(Boolean))];
  if (cleaned.length > maxItems) {
    throw new Error(`${label} supports up to ${maxItems} entries.`);
  }
  return cleaned;
}

export function assertMentionIdentityLimit(terms: string[], websites: string[]) {
  const identities = configuredMentionIdentities(terms, websites);
  if (identities.length > MAX_MENTION_IDENTITIES) {
    throw new Error(
      `Mentions supports up to ${MAX_MENTION_IDENTITIES} unique names, brands, handles, and websites total.`,
    );
  }
  return identities;
}

export function configuredMentionIdentities(terms: string[], websites: string[]) {
  return [...new Set([...terms, ...websites].map((value) => value.trim()).filter(Boolean))];
}

export function groupMentionIdentities(
  terms: string[],
  websites: string[],
  groupSize = 2,
) {
  const identities = configuredMentionIdentities(terms, websites);
  const size = Math.max(1, Math.round(groupSize));
  const groups: string[][] = [];
  for (let index = 0; index < identities.length; index += size) {
    groups.push(identities.slice(index, index + size));
  }
  return groups;
}

export async function settleMentionWork<Input, Output>(
  items: Input[],
  concurrency: number,
  operation: (item: Input, index: number) => Promise<Output>,
) {
  const results = new Array<PromiseSettledResult<Output>>(items.length);
  const workerCount = Math.min(
    items.length,
    Math.max(1, Math.round(Number.isFinite(concurrency) ? concurrency : 1)),
  );
  let nextIndex = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await operation(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export function mentionResearchCoverage(
  groups: string[][],
  results: PromiseSettledResult<unknown>[],
) {
  let completedIdentityCount = 0;
  let failedIdentityCount = 0;
  let failedGroupCount = 0;
  groups.forEach((group, index) => {
    if (results[index]?.status === "fulfilled") completedIdentityCount += group.length;
    else {
      failedIdentityCount += group.length;
      failedGroupCount += 1;
    }
  });
  return {
    totalIdentityCount: completedIdentityCount + failedIdentityCount,
    completedIdentityCount,
    failedIdentityCount,
    failedGroupCount,
  };
}
