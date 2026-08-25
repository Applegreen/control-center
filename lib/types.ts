export type IndustrySource = {
  id: string;
  name: string;
  url: string;
};

export type AiProvider = "none" | "openai" | "anthropic" | "gemini";
export type AiKeyProvider = Exclude<AiProvider, "none">;

export type AudiencePlatform =
  | "youtube"
  | "x"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "threads"
  | "tiktok";

export type AudienceAccountInput = {
  id: string;
  platform: AudiencePlatform;
  label: string;
  username: string;
  accountId: string;
  profileUrl: string;
  credential?: string;
  credentialSet?: boolean;
  clearCredential?: boolean;
};

export type PublicSettings = {
  general: {
    workspaceName: string;
  };
  industry: {
    sources: IndustrySource[];
    keywords: string[];
    description: string;
    excludedTerms: string[];
    dailyLimit: number;
  };
  mentions: {
    terms: string[];
    websites: string[];
    identityAnchors: string[];
    negativeTerms: string[];
    strictMode: boolean;
    excludeOwnedSites: boolean;
  };
  newsletters: {
    googleClientId: string;
    googleClientSecretSet: boolean;
    connected: boolean;
    connectedEmail: string;
    gmailQuery: string;
  };
  audience: {
    accounts: AudienceAccountInput[];
  };
  ai: {
    provider: AiProvider;
    model: string;
    keySet: Record<AiKeyProvider, boolean>;
    keySource: Record<AiKeyProvider, "none" | "settings" | "environment">;
  };
  dailyBrief: {
    sourceLabels: string[];
    lookbackDays: number;
  };
};

export type SettingsUpdate = Omit<
  PublicSettings,
  "newsletters" | "audience" | "industry" | "mentions" | "ai"
> & {
  industry: Omit<PublicSettings["industry"], "description" | "excludedTerms" | "dailyLimit"> &
    Partial<Pick<PublicSettings["industry"], "description" | "excludedTerms" | "dailyLimit">>;
  mentions: Omit<PublicSettings["mentions"], "negativeTerms" | "excludeOwnedSites"> &
    Partial<Pick<PublicSettings["mentions"], "negativeTerms" | "excludeOwnedSites">>;
  newsletters: PublicSettings["newsletters"] & {
    googleClientSecret?: string;
  };
  audience: {
    accounts: AudienceAccountInput[];
  };
  ai?: {
    provider: AiProvider;
    model: string;
    apiKeys?: Partial<Record<AiKeyProvider, string>>;
    clearKeys?: AiKeyProvider[];
  };
};

export type ContentWorkflow = {
  archiveReason: "user" | "expired" | "not-current";
  archivedAt?: string;
  restoreEligible: boolean;
};

export type LiveStory = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  discoveredAt?: string;
  lastModifiedAt?: string;
  matchedTerm?: string;
  kind?: "feed" | "sitemap" | "topic" | "mention";
  confidence?: "high" | "medium";
  matchReasons?: string[];
  importanceScore?: number;
  importanceReason?: string;
  collectionScope?: string;
  workflow?: ContentWorkflow;
};

export type IndustrySourceStatus = {
  sourceId: string;
  source: string;
  mode: "feed" | "sitemap" | "topics";
  endpoint: string;
  state: "live" | "baseline" | "unchanged" | "changed";
  message: string;
};

export type LiveFeedResponse = {
  configured: boolean;
  checkedAt: string;
  items: LiveStory[];
  errors: string[];
  sourceStatuses?: IndustrySourceStatus[];
  filteredOut?: number;
  reviewCount?: number;
  windowDays?: number;
  providerStatuses?: Array<{
    provider: string;
    state: "live" | "degraded" | "disabled";
    message: string;
  }>;
  freshnessHours?: number;
  discoveredCount?: number;
  surfacedLimit?: number;
  curationMode?: "local" | AiKeyProvider;
  archivedItems?: LiveStory[];
  archiveCount?: number;
  historyItems?: LiveStory[];
  historyCount?: number;
};

export type NewsletterFeedResponse = {
  configured: boolean;
  connected: boolean;
  checkedAt: string;
  items: NewsletterItem[];
  archivedItems: NewsletterItem[];
  archiveCount: number;
  errors: string[];
};

export type AudiencePrimaryMetric = "followers" | "subscribers" | "page likes";

export type AudienceMetric = {
  id: string;
  platform: AudiencePlatform;
  label: string;
  handle: string;
  total: number | null;
  change: number | null;
  changeComparedAt?: string;
  primaryLabel?: AudiencePrimaryMetric;
  secondaryLabel?: string;
  secondaryValue?: number;
  checkedAt: string;
  error?: string;
  source?: string;
  stale?: boolean;
  lastSuccessfulAt?: string;
};

export type NewsletterItem = {
  id: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  gmailUrl: string;
  workflow?: ContentWorkflow;
};

export type ReminderItem = {
  id: string | number;
  type: string;
  title: string;
  source: string;
  note: string;
  accent: string;
  url?: string;
  createdAt?: string;
  archivedAt?: string;
  added?: string;
};

export type TaskItem = {
  id: string | number;
  title: string;
  description: string;
  due: string;
  recurrence: string;
  priority: string;
  done: boolean;
  createdAt?: string;
  completedAt?: string;
  seriesId?: string | number;
  recurrenceAnchorDay?: number;
};

export type WorkspaceState = {
  reminders: ReminderItem[];
  tasks: TaskItem[];
};

export type WorkspaceStateResponse = WorkspaceState & {
  initialized: boolean;
  legacyBrowserImportAllowed: boolean;
};

export type DailyBriefItem = {
  id: string;
  source: string;
  title: string;
  summary: string;
  kind: "action" | "meeting" | "message" | "info";
  occurredAt: string;
  dueAt?: string;
  url?: string;
  syncedAt: string;
};

export type DailyBriefResponse = {
  configured: boolean;
  checkedAt: string;
  items: DailyBriefItem[];
  sourceStatuses: Array<{
    source: string;
    lastSyncedAt: string;
    lastAttemptAt: string;
    itemCount: number;
    state: "waiting" | "live" | "error";
    message: string;
  }>;
};
