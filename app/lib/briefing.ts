export type SourceStatus = "live" | "fallback" | "unavailable";

export type BriefingSourceKey = "reset" | "quota" | "model";

export interface ResetSource {
  name: string;
  url: string;
  status: SourceStatus;
  /** Stable identifier used when the quota and model feeds share one website. */
  key?: BriefingSourceKey;
  /** Time at which this feed was last fetched and parsed successfully. */
  lastSuccessAt?: string | null;
  /** Timestamp reported by the upstream dataset, when it has one. */
  dataUpdatedAt?: string | null;
  /** True when the published snapshot retained data from an earlier run. */
  fallback?: boolean;
  /** Legacy aliases kept readable by older static clients. */
  fallbackUsed?: boolean;
  cached?: boolean;
  freshness?: "fresh" | "stale" | "cached" | "unavailable";
  /** True when the feed was unavailable or is older than the freshness window. */
  stale?: boolean;
  detail?: string;
}

export interface HardResetEvent {
  id: string;
  date: string;
  title: string;
  sourceUrl: string;
}

export interface TrendPoint {
  at: string;
  value: number | null;
}

export interface QuotaTrendSeries {
  id: string;
  label: string;
  unit: string;
  points: TrendPoint[];
}

export interface QuotaSnapshotRow {
  tier: string;
  sevenDayQuota: number | null;
  basis: string;
}

export interface ModelTrendPoint {
  at: string;
  score: number | null;
  cost: number | null;
  value: number | null;
  duration: string | null;
}

export interface ModelTrendSeries {
  id: string;
  label: string;
  points: ModelTrendPoint[];
}

export interface ResetBriefing {
  generatedAt: string;
  sources: ResetSource[];
  verdict: string;
  verdictDetail: string;
  latestConfirmed: {
    title: string;
    occurredAt: string | null;
    sourceUrl: string;
  } | null;
  history: HardResetEvent[];
  quotaUpdatedAt: string | null;
  quotaSnapshot: QuotaSnapshotRow[];
  quotaTrends: QuotaTrendSeries[];
  modelUpdatedAt: string | null;
  modelTrends: ModelTrendSeries[];
}

export const expectedModelIds = [
  "gpt_6_astra_ultra",
  "gpt_6_astra_max",
  "gpt_6_astra_xhigh",
  "gpt_6_astra_high",
  "gpt_6_astra_medium",
  "gpt_6_astra_low",
  "gpt_56_sol_ultra",
  "gpt_56_sol_max",
  "gpt_56_sol_xhigh",
  "gpt_56_sol_high",
  "gpt_56_sol_medium",
  "gpt_56_sol_low",
  "gpt_56_luna_max",
  "gpt_56_luna_xhigh",
  "gpt_56_luna_high",
  "gpt_56_luna_medium",
  "gpt_56_luna_low",
  "glm_5_3_flash_max",
  "glm_5_3_flash_high",
  "glm_5_3_flash_low",
] as const;

export const expectedQuotaTiers = ["20x Pro", "5x Pro", "Plus"] as const;
const expectedQuotaTrendIds = ["pro20-7d", "pro5-5h", "plus-5h"] as const;

const expectedModelIdSet = new Set<string>(expectedModelIds);
const sourceFreshnessWindowMs: Record<BriefingSourceKey, number> = {
  reset: 3 * 60 * 60 * 1000,
  quota: 24 * 60 * 60 * 1000,
  model: 6 * 60 * 60 * 1000,
};

/**
 * Only the exact configured 20-model set (GPT-6 Astra, GPT-5.6 Sol, GPT-5.6
 * Luna, GLM 5.3 Flash and their reasoning efforts) may replace the published
 * model feed; anything partial keeps the previous complete snapshot.
 */
export function hasCompleteModelSet(series: ModelTrendSeries[]): boolean {
  const ids = new Set(series.map((item) => item.id));
  return series.length === expectedModelIds.length
    && ids.size === expectedModelIds.length
    && expectedModelIds.every((id) => ids.has(id))
    && series.every((item) => expectedModelIdSet.has(item.id) && item.points.length > 0);
}

export function hasCompleteQuotaData(
  snapshot: QuotaSnapshotRow[],
  trends: QuotaTrendSeries[],
): boolean {
  const rows = new Map(snapshot.map((row) => [row.tier, row]));
  const series = new Map(trends.map((trend) => [trend.id, trend]));
  return snapshot.length === expectedQuotaTiers.length
    && rows.size === expectedQuotaTiers.length
    && expectedQuotaTiers.every((tier) => {
      const value = rows.get(tier)?.sevenDayQuota;
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    })
    && expectedQuotaTrendIds.every((id) => series.get(id)?.points.some(
      (point) => typeof point.value === "number" && Number.isFinite(point.value),
    ));
}

function sourceKey(source: ResetSource): BriefingSourceKey | null {
  if (source.key) return source.key;
  if (/resets/i.test(source.name)) return "reset";
  if (/model|模型/i.test(source.name)) return "model";
  if (/quota|额度|雷达/i.test(source.name)) return "quota";
  return null;
}

export function findBriefingSource(
  briefing: Pick<ResetBriefing, "sources">,
  key: BriefingSourceKey,
): ResetSource | null {
  return briefing.sources.find((source) => sourceKey(source) === key)
    ?? (key === "model"
      ? briefing.sources.find((source) => /Codex 雷达/i.test(source.name)) ?? null
      : null);
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = /^\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}$/.test(value)
    ? `${value.replaceAll(".", "-").replace(" ", "T")}:00+08:00`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNotOlder(next: string | null | undefined, previous: string | null | undefined) {
  const nextTime = timestamp(next);
  const previousTime = timestamp(previous);
  if (previousTime === null) return nextTime !== null;
  return nextTime !== null && nextTime >= previousTime;
}

function latestResetAt(briefing: ResetBriefing): string | null {
  return briefing.latestConfirmed?.occurredAt
    ?? briefing.history[0]?.date
    ?? null;
}

function hasResetData(briefing: ResetBriefing) {
  return Boolean(briefing.latestConfirmed && briefing.history.length > 0);
}

function hasQuotaData(briefing: ResetBriefing) {
  return hasCompleteQuotaData(briefing.quotaSnapshot, briefing.quotaTrends);
}

function canUseLiveSource(briefing: ResetBriefing, key: BriefingSourceKey) {
  return findBriefingSource(briefing, key)?.status === "live";
}

function fallbackSource(
  key: BriefingSourceKey,
  next: ResetBriefing,
  previous: ResetBriefing,
  hasPreviousData: boolean,
  detail: string,
): ResetSource {
  const nextSource = findBriefingSource(next, key);
  const previousSource = findBriefingSource(previous, key);
  if (!hasPreviousData) {
    return {
      ...(nextSource ?? previousSource ?? { name: key, url: "" }),
      key,
      status: "unavailable",
      fallback: false,
      stale: true,
      detail,
    };
  }
  return {
    ...(previousSource ?? nextSource ?? { name: key, url: "" }),
    key,
    status: "fallback",
    fallback: true,
    stale: true,
    detail,
  };
}

function liveSource(key: BriefingSourceKey, next: ResetBriefing): ResetSource {
  const source = findBriefingSource(next, key) ?? { name: key, url: "", status: "live" as const };
  const freshnessTime = timestamp(
    key === "reset"
      ? source.lastSuccessAt
      : source.dataUpdatedAt ?? source.lastSuccessAt,
  );
  return {
    ...source,
    key,
    status: "live",
    fallback: false,
    stale: Boolean(source.stale)
      || freshnessTime === null
      || Date.now() - freshnessTime > sourceFreshnessWindowMs[key],
  };
}

/**
 * Merge a newly fetched briefing into the last published briefing without
 * allowing a partial response, an incomplete model feed, or an older upstream
 * timestamp to replace newer public data.
 */
export function mergeBriefingSnapshots(
  next: ResetBriefing,
  previous: ResetBriefing | null,
): ResetBriefing {
  if (!previous) return next;

  const resetAccepted = canUseLiveSource(next, "reset")
    && hasResetData(next)
    && isNotOlder(latestResetAt(next), latestResetAt(previous));
  const quotaAccepted = canUseLiveSource(next, "quota")
    && hasQuotaData(next)
    && isNotOlder(next.quotaUpdatedAt, previous.quotaUpdatedAt);
  const modelAccepted = canUseLiveSource(next, "model")
    && hasCompleteModelSet(next.modelTrends)
    && isNotOlder(next.modelUpdatedAt, previous.modelUpdatedAt);

  const acceptedAny = resetAccepted || quotaAccepted || modelAccepted;
  const generatedAt = acceptedAny && isNotOlder(next.generatedAt, previous.generatedAt)
    ? next.generatedAt
    : previous.generatedAt;

  return {
    ...next,
    generatedAt,
    sources: [
      resetAccepted
        ? liveSource("reset", next)
        : fallbackSource("reset", next, previous, hasResetData(previous), "重置源不可用或返回了更早的记录，沿用上次成功数据。"),
      quotaAccepted
        ? liveSource("quota", next)
        : fallbackSource("quota", next, previous, hasQuotaData(previous), "额度源不可用或数据时间倒退，沿用上次成功数据。"),
      modelAccepted
        ? liveSource("model", next)
        : fallbackSource("model", next, previous, hasCompleteModelSet(previous.modelTrends), `模型源不可用、数据时间倒退或未返回完整 ${expectedModelIds.length} 个模型，沿用上次完整数据。`),
    ],
    verdict: resetAccepted ? next.verdict : previous.verdict,
    verdictDetail: resetAccepted ? next.verdictDetail : previous.verdictDetail,
    latestConfirmed: resetAccepted ? next.latestConfirmed : previous.latestConfirmed,
    history: resetAccepted ? next.history : previous.history,
    quotaUpdatedAt: quotaAccepted ? next.quotaUpdatedAt : previous.quotaUpdatedAt,
    quotaSnapshot: quotaAccepted ? next.quotaSnapshot : previous.quotaSnapshot,
    quotaTrends: quotaAccepted ? next.quotaTrends : previous.quotaTrends,
    modelUpdatedAt: modelAccepted ? next.modelUpdatedAt : previous.modelUpdatedAt,
    modelTrends: modelAccepted ? next.modelTrends : previous.modelTrends,
  };
}
