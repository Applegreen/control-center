import "server-only";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  chmod,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AiKeyProvider,
  AudienceAccountInput,
  PublicSettings,
  SettingsUpdate,
} from "@/lib/types";
import {
  assertMentionIdentityLimit,
  cleanBoundedMentionValues,
  MAX_MENTION_CONTEXT_VALUES,
  MAX_MENTION_IDENTITIES,
} from "@/lib/mention-work";
import { isValidPublicProfileUrl } from "@/lib/public-metrics";

type StoredAudienceAccount = Omit<
  AudienceAccountInput,
  "credentialSet" | "clearCredential"
> & {
  credential: string;
};

export type StoredSettings = {
  general: { workspaceName: string };
  industry: PublicSettings["industry"];
  mentions: PublicSettings["mentions"];
  newsletters: {
    googleClientId: string;
    googleClientSecret: string;
    connectedEmail: string;
    refreshToken: string;
    accessToken: string;
    accessTokenExpiresAt: number;
    gmailQuery: string;
  };
  audience: { accounts: StoredAudienceAccount[] };
  ai: {
    provider: PublicSettings["ai"]["provider"];
    model: string;
    apiKeys: Record<AiKeyProvider, string>;
  };
  dailyBrief: PublicSettings["dailyBrief"];
};

const defaults: StoredSettings = {
  general: { workspaceName: "Control Center" },
  industry: {
    sources: [],
    keywords: [],
    description: "",
    excludedTerms: [],
    dailyLimit: 30,
  },
  mentions: {
    terms: [],
    websites: [],
    identityAnchors: [],
    negativeTerms: [],
    strictMode: true,
    excludeOwnedSites: true,
  },
  newsletters: {
    googleClientId: "",
    googleClientSecret: "",
    connectedEmail: "",
    refreshToken: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    gmailQuery: "newer_than:30d (category:updates OR category:promotions)",
  },
  audience: { accounts: [] },
  ai: {
    provider: "none",
    model: "",
    apiKeys: { openai: "", anthropic: "", gemini: "" },
  },
  dailyBrief: { sourceLabels: [], lookbackDays: 7 },
};

let settingsWriteQueue = Promise.resolve();

function serializeSettingsWrite<T>(operation: () => Promise<T>) {
  const result = settingsWriteQueue.then(operation, operation);
  settingsWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function defaultDataDirectory() {
  if (process.platform === "darwin")
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Control Center",
    );
  if (process.platform === "win32")
    return path.join(
      process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(),
      "Control Center",
    );
  return path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "control-center",
  );
}

export function dataDirectory() {
  const configured = process.env.CONTROL_CENTER_DATA_DIR?.trim();
  if (configured) {
    if (!path.isAbsolute(configured))
      throw new Error("CONTROL_CENTER_DATA_DIR must be an absolute path.");
    return configured;
  }
  const legacy = path.join(process.cwd(), ".control-center");
  return existsSync(legacy) ? legacy : defaultDataDirectory();
}

export function legacyBrowserImportAllowed() {
  const legacy = path.join(process.cwd(), ".control-center");
  return existsSync(legacy) && path.resolve(dataDirectory()) === path.resolve(legacy);
}

export function settingsPath() {
  return path.join(dataDirectory(), "settings.json");
}

export function snapshotsPath() {
  return path.join(dataDirectory(), "snapshots.json");
}

export function industrySnapshotsPath() {
  return path.join(dataDirectory(), "industry-snapshots.json");
}

export async function readSettings(): Promise<StoredSettings> {
  try {
    const parsed = JSON.parse(
      await readFile(settingsPath(), "utf8"),
    ) as Partial<StoredSettings>;
    return {
      general: { ...defaults.general, ...parsed.general },
      industry: { ...defaults.industry, ...parsed.industry },
      mentions: { ...defaults.mentions, ...parsed.mentions },
      newsletters: { ...defaults.newsletters, ...parsed.newsletters },
      audience: {
        accounts: (parsed.audience?.accounts ?? []).map((account) => ({
          ...account,
          profileUrl: account.profileUrl ?? "",
        })),
      },
      ai: {
        ...defaults.ai,
        ...parsed.ai,
        apiKeys: { ...defaults.ai.apiKeys, ...parsed.ai?.apiKeys },
      },
      dailyBrief: { ...defaults.dailyBrief, ...parsed.dailyBrief },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return structuredClone(defaults);
  }
}

async function writeSettingsUnlocked(settings: StoredSettings) {
  const directory = dataDirectory();
  const target = settingsPath();
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, target);
    await chmod(target, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writeSettings(settings: StoredSettings) {
  return serializeSettingsWrite(() => writeSettingsUnlocked(settings));
}

export function toPublicSettings(settings: StoredSettings): PublicSettings {
  const aiKeySource = (provider: AiKeyProvider) =>
    settings.ai.apiKeys[provider]?.trim()
      ? "settings" as const
      : environmentAiApiKey(provider)
        ? "environment" as const
        : "none" as const;
  return {
    general: settings.general,
    industry: settings.industry,
    mentions: settings.mentions,
    newsletters: {
      googleClientId: settings.newsletters.googleClientId,
      googleClientSecretSet: Boolean(settings.newsletters.googleClientSecret),
      connected: Boolean(
        settings.newsletters.refreshToken &&
          settings.newsletters.connectedEmail,
      ),
      connectedEmail: settings.newsletters.connectedEmail,
      gmailQuery: settings.newsletters.gmailQuery,
    },
    audience: {
      accounts: settings.audience.accounts.map(
        ({ credential, ...account }) => ({
          ...account,
          profileUrl:
            account.profileUrl &&
            isValidPublicProfileUrl(account.platform, account.profileUrl)
              ? account.profileUrl
              : "",
          credentialSet: Boolean(credential),
        }),
      ),
    },
    ai: {
      provider: settings.ai.provider,
      model: settings.ai.model,
      keySet: {
        openai: Boolean(configuredAiApiKey(settings, "openai")),
        anthropic: Boolean(configuredAiApiKey(settings, "anthropic")),
        gemini: Boolean(configuredAiApiKey(settings, "gemini")),
      },
      keySource: {
        openai: aiKeySource("openai"),
        anthropic: aiKeySource("anthropic"),
        gemini: aiKeySource("gemini"),
      },
    },
    dailyBrief: settings.dailyBrief,
  };
}

export function configuredAiApiKey(
  settings: StoredSettings,
  provider: AiKeyProvider,
) {
  return settings.ai.apiKeys[provider]?.trim() || environmentAiApiKey(provider);
}

function environmentAiApiKey(provider: AiKeyProvider) {
  const environmentKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return environmentKey?.trim() || "";
}

function cleanList(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanIndustrySources(sources: SettingsUpdate["industry"]["sources"]) {
  const cleaned = sources.flatMap((source) => {
    const value = source.url.trim();
    if (!value) return [];
    let url: URL;
    try {
      url = new URL(value.includes("://") ? value : `https://${value}`);
    } catch {
      throw new Error(
        `${source.name.trim() || value}: enter a valid website, RSS, or Atom URL.`,
      );
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error(
        `${source.name.trim() || value}: only public HTTP or HTTPS URLs without embedded credentials are supported.`,
      );
    }
    return [
      {
        id: source.id.trim() || randomUUID(),
        name: source.name.trim() || url.hostname.replace(/^www\./, ""),
        url: url.toString(),
      },
    ];
  });
  return [...new Map(cleaned.map((source) => [source.url, source])).values()];
}

export async function updateSettings(update: SettingsUpdate) {
  return serializeSettingsWrite(async () => {
    const current = await readSettings();
    const currentAccounts = new Map(
      current.audience.accounts.map((account) => [account.id, account]),
    );
    const nextAiKeys = { ...current.ai.apiKeys };
    for (const provider of update.ai?.clearKeys ?? []) {
      if (["openai", "anthropic", "gemini"].includes(provider))
        nextAiKeys[provider] = "";
    }
    for (const provider of ["openai", "anthropic", "gemini"] as const) {
      const incoming = update.ai?.apiKeys?.[provider]?.trim();
      if (incoming) nextAiKeys[provider] = incoming;
    }
    const cleanedAccounts = update.audience.accounts.map((account) => {
      const profileUrl = account.profileUrl?.trim() || "";
      if (
        profileUrl &&
        !isValidPublicProfileUrl(account.platform, profileUrl)
      ) {
        throw new Error(
          `${account.label.trim() || account.platform}: enter a valid ${account.platform} profile URL, or leave the URL blank and use the handle.`,
        );
      }
      if (
        !account.username.trim() &&
        !profileUrl &&
        !account.accountId.trim()
      ) {
        throw new Error(
          `${account.label.trim() || account.platform}: add a username, public profile URL, or official account ID.`,
        );
      }
      return {
        id: account.id.trim() || randomUUID(),
        platform: account.platform,
        label: account.label.trim() || account.platform,
        username: account.username.trim().replace(/^@/, ""),
        accountId: account.accountId.trim(),
        profileUrl,
        credential: account.clearCredential
          ? ""
          : account.credential?.trim() ||
            currentAccounts.get(account.id)?.credential ||
            "",
      };
    });
    const accountKeys = new Set<string>();
    for (const account of cleanedAccounts) {
      const identity = (
        account.profileUrl ||
        account.username ||
        account.accountId
      )
        .toLowerCase()
        .replace(/\/$/, "");
      const key = `${account.platform}:${identity}`;
      if (accountKeys.has(key)) {
        throw new Error(
          `${account.label}: this ${account.platform} profile is already in Audience settings.`,
        );
      }
      accountKeys.add(key);
    }
    const mentionTerms = cleanBoundedMentionValues(
      update.mentions.terms,
      "Mention names, brands, and handles",
      MAX_MENTION_IDENTITIES,
    );
    const mentionWebsites = cleanBoundedMentionValues(
      update.mentions.websites,
      "Mention websites",
      MAX_MENTION_IDENTITIES,
    );
    assertMentionIdentityLimit(mentionTerms, mentionWebsites);
    const mentionIdentityAnchors = cleanBoundedMentionValues(
      update.mentions.identityAnchors ?? [],
      "Mention identity anchors",
      MAX_MENTION_CONTEXT_VALUES,
    );
    const mentionNegativeTerms = cleanBoundedMentionValues(
      update.mentions.negativeTerms ?? [],
      "Mention excluded contexts",
      MAX_MENTION_CONTEXT_VALUES,
    );
    const next: StoredSettings = {
      general: {
        workspaceName:
          update.general.workspaceName.trim() || defaults.general.workspaceName,
      },
      industry: {
        sources: cleanIndustrySources(update.industry.sources),
        keywords: cleanList(update.industry.keywords),
        description: (update.industry.description ?? "").trim().slice(0, 1_000),
        excludedTerms: cleanList(update.industry.excludedTerms ?? []),
        dailyLimit: Math.min(
          50,
          Math.max(
            10,
            Math.round(Number(update.industry.dailyLimit) || defaults.industry.dailyLimit),
          ),
        ),
      },
      mentions: {
        terms: mentionTerms,
        websites: mentionWebsites,
        identityAnchors: mentionIdentityAnchors,
        negativeTerms: mentionNegativeTerms,
        strictMode: update.mentions.strictMode !== false,
        excludeOwnedSites: update.mentions.excludeOwnedSites !== false,
      },
      newsletters: {
        ...current.newsletters,
        googleClientId: update.newsletters.googleClientId.trim(),
        googleClientSecret:
          update.newsletters.googleClientSecret?.trim() ||
          current.newsletters.googleClientSecret,
        gmailQuery:
          update.newsletters.gmailQuery?.trim().slice(0, 500) ||
          defaults.newsletters.gmailQuery,
      },
      audience: {
        accounts: cleanedAccounts,
      },
      ai: {
        provider: update.ai === undefined
          ? current.ai.provider
          : ["openai", "anthropic", "gemini"].includes(update.ai.provider)
            ? update.ai.provider
            : "none",
        model: update.ai === undefined
          ? current.ai.model
          : update.ai.model.trim().slice(0, 120),
        apiKeys: nextAiKeys,
      },
      dailyBrief: {
        sourceLabels: cleanList(update.dailyBrief?.sourceLabels ?? []),
        lookbackDays: Math.min(
          30,
          Math.max(
            1,
            Math.round(
              Number(update.dailyBrief?.lookbackDays) ||
                defaults.dailyBrief.lookbackDays,
            ),
          ),
        ),
      },
    };
    await writeSettingsUnlocked(next);
    return toPublicSettings(next);
  });
}

export async function saveGmailTokens(tokens: {
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}) {
  return serializeSettingsWrite(async () => {
    const settings = await readSettings();
    settings.newsletters.connectedEmail = tokens.email;
    settings.newsletters.accessToken = tokens.accessToken;
    settings.newsletters.accessTokenExpiresAt = tokens.expiresAt;
    if (tokens.refreshToken)
      settings.newsletters.refreshToken = tokens.refreshToken;
    await writeSettingsUnlocked(settings);
  });
}

export async function disconnectGmail() {
  return serializeSettingsWrite(async () => {
    const settings = await readSettings();
    settings.newsletters.connectedEmail = "";
    settings.newsletters.refreshToken = "";
    settings.newsletters.accessToken = "";
    settings.newsletters.accessTokenExpiresAt = 0;
    await writeSettingsUnlocked(settings);
  });
}
