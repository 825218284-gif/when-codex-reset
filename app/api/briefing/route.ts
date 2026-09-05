import type {
  HardResetEvent,
  ModelTrendPoint,
  ModelTrendSeries,
  QuotaSnapshotRow,
  QuotaTrendSeries,
  ResetBriefing,
  TrendPoint,
} from "../../lib/briefing";
import { hasCompleteModelSet, hasCompleteQuotaData } from "../../lib/briefing.ts";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const CODEX_RADAR_API = "https://codexradar.com/current.json";
const CODEX_RADAR_INTELLIGENCE_API = "https://codexradar.com/data/intelligence-efficiency.json";
const CODEX_RESETS_SITE = "https://codex-resets.com/";
const SOURCE_TIMEOUT_MS = 15_000;
const CODEX_RADAR_HOSTS = new Set(["codexradar.com", "www.codexradar.com"]);
const RESET_PAGE_HOSTS = new Set(["codex-resets.com", "www.codex-resets.com"]);
const RESET_LINK_HOSTS = new Set([
  ...RESET_PAGE_HOSTS,
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
]);

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—");
}

function plainText(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function safeHttpsUrl(value: string, allowedHosts?: ReadonlySet<string>) {
  try {
    const url = new URL(value, CODEX_RESETS_SITE);
    if (url.protocol !== "https:") return null;
    if (allowedHosts && !allowedHosts.has(url.hostname.toLowerCase())) return null;
    return url.href;
  } catch {
    return null;
  }
}

function formatResetTimelineTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}.${pick("month")}.${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function resetTitle(text: string) {
  const value = plainText(text);
  if (/banked reset/i.test(value)) return "已发放可自行使用的额度重置";
  if (/all paid|all plans|all accounts|everyone|all .*users/i.test(value)) return "全体用户额度重置";
  if (/plus\s*(?:&|and)?\s*pro/i.test(value)) return "Plus / Pro 额度重置";
  if (/full reset/i.test(value)) return "全量额度重置";
  return value.length > 58 ? `${value.slice(0, 58)}…` : value || "已记录额度重置";
}

export function parseCodexResets(html: string) {
  const parsedHistory: Array<HardResetEvent & { occurredAt: string }> = [];
  const items = html.matchAll(/<li\b[^>]*class=["'][^"']*\blog-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi);

  for (const [index, item] of [...items].entries()) {
    const body = item[1];
    const occurredAt = body.match(/data-datetime=["']([^"']+)["']/i)?.[1];
    const rawSourceUrl = [...body.matchAll(/<a\b([^>]*)>/gi)]
      .find((anchor) => /class=["'][^"']*\blog-item-link\b/i.test(anchor[1]))?.[1]
      ?.match(/href=["']([^"']+)["']/i)?.[1] ?? CODEX_RESETS_SITE;
    const sourceUrl = safeHttpsUrl(rawSourceUrl, RESET_LINK_HOSTS) ?? CODEX_RESETS_SITE;
    const text = body.match(/<p\b[^>]*class=["'][^"']*\blog-item-text\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if (!occurredAt || !text || Number.isNaN(Date.parse(occurredAt))) continue;
    parsedHistory.push({
      id: sourceUrl.split("/").at(-1) || `reset-${index + 1}`,
      date: formatResetTimelineTime(occurredAt),
      title: resetTitle(text),
      sourceUrl,
      occurredAt,
    });
  }

  parsedHistory.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const history: HardResetEvent[] = parsedHistory.map((event) => ({
    id: event.id,
    date: event.date,
    title: event.title,
    sourceUrl: event.sourceUrl,
  }));

  const generatedNode = html.match(/<[^>]*data-role=["']generated-at["'][^>]*>/i)?.[0] ?? "";
  const generatedAt = generatedNode.match(/data-datetime=["']([^"']+)["']/i)?.[1] ?? null;
  const totalResets = asNumber(html.match(/<dt>\s*Total resets\s*<\/dt>[\s\S]*?<dd[^>]*>\s*(\d+)/i)?.[1]) ?? history.length;
  const latest = parsedHistory[0];

  return {
    generatedAt,
    history,
    totalResets,
    verdict: latest ? "最近一次额度重置已记录" : "正在读取额度重置记录",
    latestConfirmed: latest
      ? { title: latest.title, occurredAt: latest.occurredAt, sourceUrl: latest.sourceUrl }
      : null,
  };
}

const intelligenceConfigurations = [
  { id: "gpt_6_astra_ultra", model: "gpt-6-astra", effort: "ultra", label: "GPT-6 Astra ultra" },
  { id: "gpt_6_astra_max", model: "gpt-6-astra", effort: "max", label: "GPT-6 Astra max" },
  { id: "gpt_6_astra_xhigh", model: "gpt-6-astra", effort: "xhigh", label: "GPT-6 Astra xhigh" },
  { id: "gpt_6_astra_high", model: "gpt-6-astra", effort: "high", label: "GPT-6 Astra high" },
  { id: "gpt_6_astra_medium", model: "gpt-6-astra", effort: "medium", label: "GPT-6 Astra medium" },
  { id: "gpt_6_astra_low", model: "gpt-6-astra", effort: "low", label: "GPT-6 Astra low" },
  { id: "gpt_56_sol_ultra", model: "gpt-5.6-sol", effort: "ultra", label: "GPT-5.6 Sol ultra" },
  { id: "gpt_56_sol_max", model: "gpt-5.6-sol", effort: "max", label: "GPT-5.6 Sol max" },
  { id: "gpt_56_sol_xhigh", model: "gpt-5.6-sol", effort: "xhigh", label: "GPT-5.6 Sol xhigh" },
  { id: "gpt_56_sol_high", model: "gpt-5.6-sol", effort: "high", label: "GPT-5.6 Sol high" },
  { id: "gpt_56_sol_medium", model: "gpt-5.6-sol", effort: "medium", label: "GPT-5.6 Sol medium" },
  { id: "gpt_56_sol_low", model: "gpt-5.6-sol", effort: "low", label: "GPT-5.6 Sol low" },
  { id: "gpt_56_luna_max", model: "gpt-5.6-luna", effort: "max", label: "GPT-5.6 Luna max" },
  { id: "gpt_56_luna_xhigh", model: "gpt-5.6-luna", effort: "xhigh", label: "GPT-5.6 Luna xhigh" },
  { id: "gpt_56_luna_high", model: "gpt-5.6-luna", effort: "high", label: "GPT-5.6 Luna high" },
  { id: "gpt_56_luna_medium", model: "gpt-5.6-luna", effort: "medium", label: "GPT-5.6 Luna medium" },
  { id: "gpt_56_luna_low", model: "gpt-5.6-luna", effort: "low", label: "GPT-5.6 Luna low" },
  { id: "glm_5_3_flash_max", model: "glm-5.3-flash", effort: "max", label: "GLM 5.3 Flash max" },
  { id: "glm_5_3_flash_high", model: "glm-5.3-flash", effort: "high", label: "GLM 5.3 Flash high" },
  { id: "glm_5_3_flash_low", model: "glm-5.3-flash", effort: "low", label: "GLM 5.3 Flash low" },
] as const;

function intelligencePoint(raw: UnknownRecord, at: string): ModelTrendPoint | null {
  const score = asNumber(raw.iq);
  if (!at || score === null) return null;
  const cost = asNumber(raw.average_price_usd);
  const minutes = asNumber(raw.average_minutes);
  return {
    at,
    score,
    cost,
    value: cost !== null && cost > 0 ? score / cost : null,
    duration: minutes === null ? null : `${Math.round(minutes)}分钟`,
  };
}

function collectIntelligenceModelTrends(payload: UnknownRecord): ModelTrendSeries[] {
  const latestAt = asString(payload.source_updated_at);
  const latestRows = Array.isArray(payload.points) ? payload.points.map(asRecord) : [];
  const history = Array.isArray(payload.history) ? payload.history.map(asRecord) : [];

  return intelligenceConfigurations.flatMap((configuration) => {
    const byTime = new Map<string, ModelTrendPoint>();
    for (const snapshot of history) {
      const at = asString(snapshot.at);
      const row = (Array.isArray(snapshot.points) ? snapshot.points : [])
        .map(asRecord)
        .find((candidate) => asString(candidate.model) === configuration.model
          && asString(candidate.effort) === configuration.effort);
      const point = row ? intelligencePoint(row, at) : null;
      if (point) byTime.set(point.at, point);
    }

    const latest = latestRows.find((candidate) => asString(candidate.model) === configuration.model
      && asString(candidate.effort) === configuration.effort);
    const current = latest ? intelligencePoint(latest, latestAt) : null;
    if (current) byTime.set(current.at, current);

    const points = [...byTime.values()]
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-10);
    return points.length ? [{ id: configuration.id, label: configuration.label, points }] : [];
  });
}

function collectQuotaTrends(radar: UnknownRecord): QuotaTrendSeries[] {
  const quotaRadar = asRecord(asRecord(radar.model_iq).quota_radar);
  const rows = Array.isArray(quotaRadar.trend) ? quotaRadar.trend : [];
  const definitions = [
    { id: "pro20-7d", label: "20x Pro · 7d", field: "seven_d_20x", unit: "USD / 7d" },
    { id: "pro5-5h", label: "5x Pro · 5h", field: "five_h_5x", unit: "USD / 5h" },
    { id: "plus-5h", label: "Plus · 5h", field: "five_h_plus", unit: "USD / 5h" },
  ];

  return definitions
    .map(({ id, label, field, unit }) => {
      const points: TrendPoint[] = rows.map((row) => {
        const item = asRecord(row);
        return { at: asString(item.date), value: asNumber(item[field]) };
      });
      return { id, label, unit, points };
    })
    .filter((series) => series.points.some((point) => point.value !== null));
}

function quotaBasisLabel(value: unknown) {
  const basis = asString(value);
  if (/distributed radar/i.test(basis)) return "分布式雷达";
  if (/estimated/i.test(basis)) return "推算";
  return basis || "公开观测";
}

function collectQuotaSnapshot(radar: UnknownRecord): QuotaSnapshotRow[] {
  const quotaRadar = asRecord(asRecord(radar.model_iq).quota_radar);
  const rows = Array.isArray(quotaRadar.rows) ? quotaRadar.rows : [];

  return rows.map((raw) => {
    const row = asRecord(raw);
    return {
      tier: asString(row.tier, "—"),
      sevenDayQuota: asNumber(row.seven_d),
      basis: quotaBasisLabel(row.basis),
    };
  });
}

async function fetchTextSource(
  rawUrl: string,
  allowedHosts: ReadonlySet<string>,
  headers: HeadersInit,
) {
  const url = safeHttpsUrl(rawUrl, allowedHosts);
  if (!url) throw new Error("Rejected non-HTTPS or unapproved reset source URL");
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  if (response.url && !safeHttpsUrl(response.url, allowedHosts)) {
    throw new Error("Reset source redirected outside the approved HTTPS hosts");
  }
  return response.text();
}

async function fetchJsonSource(rawUrl: string, allowedHosts: ReadonlySet<string>) {
  const url = safeHttpsUrl(rawUrl, allowedHosts);
  if (!url) throw new Error("Rejected non-HTTPS source URL");
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  if (response.url && !safeHttpsUrl(response.url, allowedHosts)) {
    throw new Error("Source redirected outside the approved HTTPS hosts");
  }
  return (await response.json()) as UnknownRecord;
}

function failureDetail(result: PromiseSettledResult<unknown>, fallback: string) {
  if (result.status === "fulfilled") return fallback;
  return result.reason instanceof Error ? result.reason.message : fallback;
}

function dataIsOlderThan(value: string | null, maxAgeMs: number) {
  if (!value) return true;
  const time = Date.parse(value);
  return !Number.isFinite(time) || Date.now() - time > maxAgeMs;
}

export async function GET() {
  const startedAt = new Date().toISOString();
  const [resetResult, codexResult, intelligenceResult] = await Promise.allSettled([
    fetchTextSource(
      CODEX_RESETS_SITE,
      RESET_PAGE_HOSTS,
      {
        accept: "text/html",
        "user-agent": "Codex-Reset-Timeline/1.0 (source mirror)",
      },
    ).then(parseCodexResets),
    fetchJsonSource(CODEX_RADAR_API, CODEX_RADAR_HOSTS),
    fetchJsonSource(CODEX_RADAR_INTELLIGENCE_API, CODEX_RADAR_HOSTS),
  ]);

  const parsedResets = resetResult.status === "fulfilled" ? resetResult.value : null;
  const codexResets = parsedResets?.history.length && parsedResets.latestConfirmed
    ? parsedResets
    : null;
  const codexRadar = codexResult.status === "fulfilled" ? codexResult.value : null;
  const intelligence = intelligenceResult.status === "fulfilled" ? intelligenceResult.value : null;
  const intelligenceModels = intelligence ? collectIntelligenceModelTrends(intelligence) : [];
  const completeIntelligence = hasCompleteModelSet(intelligenceModels);
  const quotaUpdatedAt = codexRadar
    ? asString(asRecord(asRecord(codexRadar.model_iq).quota_radar).updated_at) || null
    : null;
  const quotaSnapshot = codexRadar ? collectQuotaSnapshot(codexRadar) : [];
  const quotaTrends = codexRadar ? collectQuotaTrends(codexRadar) : [];
  const quotaLive = Boolean(quotaUpdatedAt) && hasCompleteQuotaData(quotaSnapshot, quotaTrends);
  const modelUpdatedAt = completeIntelligence
    ? asString(intelligence?.source_updated_at) || null
    : null;
  const successfulSourceCount = Number(Boolean(codexResets)) + Number(quotaLive) + Number(completeIntelligence);
  const completedAt = new Date().toISOString();
  const briefing: ResetBriefing = {
    generatedAt: successfulSourceCount ? completedAt : "",
    sources: [
      {
        key: "reset",
        name: "Codex Resets",
        url: CODEX_RESETS_SITE,
        status: codexResets ? "live" : "unavailable",
        lastSuccessAt: codexResets ? completedAt : null,
        dataUpdatedAt: codexResets?.latestConfirmed?.occurredAt ?? null,
        fallback: false,
        stale: !codexResets,
        detail: codexResets
          ? "重置页面已成功读取。"
          : failureDetail(resetResult, "页面未返回可配对的重置时间与标题。"),
      },
      {
        key: "quota",
        name: "Codex 雷达 · 额度",
        url: CODEX_RADAR_API,
        status: quotaLive ? "live" : "unavailable",
        lastSuccessAt: quotaLive ? completedAt : null,
        dataUpdatedAt: quotaUpdatedAt,
        fallback: false,
        stale: !quotaLive || dataIsOlderThan(quotaUpdatedAt, 24 * 60 * 60 * 1000),
        detail: quotaLive
          ? "额度快照和趋势已成功读取。"
          : failureDetail(codexResult, "额度数据不完整。"),
      },
      {
        key: "model",
        name: "Codex 雷达 · 模型",
        url: CODEX_RADAR_INTELLIGENCE_API,
        status: completeIntelligence ? "live" : "unavailable",
        lastSuccessAt: completeIntelligence ? completedAt : null,
        dataUpdatedAt: modelUpdatedAt,
        fallback: false,
        stale: !completeIntelligence || dataIsOlderThan(modelUpdatedAt, 6 * 60 * 60 * 1000),
        detail: completeIntelligence
          ? `完整 ${intelligenceConfigurations.length} 个模型已成功读取。`
          : intelligenceResult.status === "fulfilled"
            ? `模型数据不完整（${intelligenceModels.length}/${intelligenceConfigurations.length}），不会覆盖完整快照。`
            : failureDetail(intelligenceResult, "模型数据不可用。"),
      },
    ],
    verdict: codexResets?.verdict ?? "暂时无法核验",
    verdictDetail: codexResets
      ? `Codex Resets 已记录 ${codexResets.totalResets} 次额度重置；按 @thsottiaux 的 X 公告自动分类。`
      : "请稍后刷新，或直接打开来源站点。",
    latestConfirmed: codexResets?.latestConfirmed ?? null,
    history: codexResets?.history.slice(0, 4) ?? [],
    quotaUpdatedAt: quotaLive ? quotaUpdatedAt : null,
    quotaSnapshot: quotaLive ? quotaSnapshot : [],
    quotaTrends: quotaLive ? quotaTrends : [],
    modelUpdatedAt,
    modelTrends: completeIntelligence ? intelligenceModels : [],
  };

  return Response.json(briefing, {
    status: successfulSourceCount ? 200 : 502,
    headers: {
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
      "X-Briefing-Started-At": startedAt,
    },
  });
}
