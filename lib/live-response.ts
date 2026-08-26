export type CachedFeedItem = {
  id: string;
  workflow?: {
    archiveReason: "user" | "expired" | "not-current";
    archivedAt?: string;
    restoreEligible: boolean;
  };
};

export type CachedFeedPayload = {
  items: CachedFeedItem[];
  archivedItems?: CachedFeedItem[];
  archiveCount?: number;
  historyItems?: CachedFeedItem[];
};

function withoutItem<T extends CachedFeedItem>(items: T[] | undefined, id: string) {
  return (items || []).filter((item) => item.id !== id);
}

export function applyArchiveToPayload<T extends CachedFeedPayload>(
  payload: T,
  id: string,
  archived: boolean,
  now = new Date().toISOString(),
): T {
  const activeItem = payload.items.find((item) => item.id === id);
  const archivedItem = payload.archivedItems?.find((item) => item.id === id);
  const candidate = activeItem || archivedItem;
  if (!candidate) return payload;

  const items = withoutItem(payload.items, id);
  const archivedItems = withoutItem(payload.archivedItems, id);
  if (archived) {
    archivedItems.unshift({
      ...candidate,
      workflow: {
        archiveReason: "user",
        archivedAt: now,
        restoreEligible: true,
      },
    });
  } else {
    const restored = { ...candidate };
    Reflect.deleteProperty(restored, "workflow");
    items.unshift(restored);
  }

  return {
    ...payload,
    items,
    archivedItems,
    archiveCount: archivedItems.length,
  } as T;
}
