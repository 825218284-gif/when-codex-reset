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
const CODEX_RESETS_SITE = "https://codex-resets.com/";
const LLM_STATS_API = "https://llm-stats.com/api/models";
const LLM_STATS_SITE = "https://llm-stats.com/";
const SOURCE_TIMEOUT_MS = 15_000;
const CODEX_RADAR_HOSTS = new Set(["codexradar.com", "www.codexradar.com"]);
const RESET_PAGE_HOSTS = new Set(["codex-resets.com", "www.codex-resets.com"]);
const LLM_STATS_HOSTS = new Set(["llm-stats.com"]);
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
  const resetKinds = new Map<string, "banked" | "regular">();
  for (const [, kind, day] of html.matchAll(/data-reset-type=["'](banked|regular)["'][^>]*?data-date=["'](\d{4}-\d{2}-\d{2})["']/gi)) {
    resetKinds.set(day, kind as "banked" | "regular");
  }
  for (const [, day, kind] of html.matchAll(/data-date=["'](\d{4}-\d{2}-\d{2})["'][^>]*?data-reset-type=["'](banked|regular)["']/gi)) {
    if (!resetKinds.has(day)) resetKinds.set(day, kind as "banked" | "regular");
  }

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
      kind: resetKinds.get(occurredAt.slice(0, 10)),
      occurredAt,
    });
  }

  parsedHistory.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const history: HardResetEvent[] = parsedHistory.map((event) => ({
    id: event.id,
    date: event.date,
    title: event.title,
    sourceUrl: event.sourceUrl,
    kind: event.kind,
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

const llmStatsModels = [
  { id: "gpt_6_astra", slug: "gpt-6-astra", label: "GPT-6 Astra" },
  { id: "gpt_61_sol", slug: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
  { id: "gpt_6_luna", slug: "gpt-6-luna", label: "GPT-6 Luna" },
  { id: "glm_5_3_flash", slug: "glm-5.3-flash", label: "GLM 5.3 Flash" },
  { id: "deepseek_v4_1_flash", slug: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
] as const;

type LlmStatsModel = {
  id: string;
  slug: string;
  label: string;
  detail: UnknownRecord | null;
};

/** Fetch every tracked model's llm-stats detail page; a failed model yields a null detail. */
async function fetchLlmStatsModels(): Promise<LlmStatsModel[]> {
  const settled = await Promise.allSettled(
    llmStatsModels.map(({ slug }) => fetchJsonSource(`${LLM_STATS_API}/${slug}`, LLM_STATS_HOSTS)),
  );
  return llmStatsModels.map(({ id, slug, label }, index) => {
    const result = settled[index];
    return {
      id,
      slug,
      label,
      detail: result.status === "fulfilled" ? result.value : null,
    };
  });
}

function collectLlmStatsModels(models: LlmStatsModel[]): ModelTrendSeries[] {
  const at = new Date().toISOString();
  return models.flatMap(({ id, label, detail }) => {
    if (!detail) return [];
    const benchmarks = Array.isArray(detail.benchmarks) ? detail.benchmarks.map(asRecord) : [];
    const normalized = benchmarks
      .map((benchmark) => asNumber(benchmark.normalized_score))
      .filter((score): score is number => score !== null && score > 0 && score <= 1);
    if (!normalized.length) return [];
    const score = Math.round((normalized.reduce((sum, value) => sum + value, 0) / normalized.length) * 1000) / 10;
    // Detail payloads carry pricing and limits on the first listed provider.
    const provider = (Array.isArray(detail.providers) ? detail.providers.map(asRecord) : [])[0] ?? asRecord({});
    const pricing = asRecord(provider.pricing);
    const limits = asRecord(provider.limits);
    const point: ModelTrendPoint = {
      at,
      score,
      inputPrice: asNumber(pricing.input_per_million),
      outputPrice: asNumber(pricing.output_per_million),
      contextWindow: asNumber(limits.max_input_tokens),
    };
    return [{ id, label, points: [point] }];
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
  const [resetResult, codexResult, llmStatsResult] = await Promise.allSettled([
    fetchTextSource(
      CODEX_RESETS_SITE,
      RESET_PAGE_HOSTS,
      {
        accept: "text/html",
        "user-agent": "Codex-Reset-Timeline/1.0 (source mirror)",
      },
    ).then(parseCodexResets),
    fetchJsonSource(CODEX_RADAR_API, CODEX_RADAR_HOSTS),
    fetchLlmStatsModels(),
  ]);

  const parsedResets = resetResult.status === "fulfilled" ? resetResult.value : null;
  const codexResets = parsedResets?.history.length && parsedResets.latestConfirmed
    ? parsedResets
    : null;
  const codexRadar = codexResult.status === "fulfilled" ? codexResult.value : null;
  const llmStatsModelsFetched = llmStatsResult.status === "fulfilled" ? llmStatsResult.value : [];
  const modelTrends = collectLlmStatsModels(llmStatsModelsFetched);
  const completeModels = hasCompleteModelSet(modelTrends);
  const quotaUpdatedAt = codexRadar
    ? asString(asRecord(asRecord(codexRadar.model_iq).quota_radar).updated_at) || null
    : null;
  const quotaSnapshot = codexRadar ? collectQuotaSnapshot(codexRadar) : [];
  const quotaTrends = codexRadar ? collectQuotaTrends(codexRadar) : [];
  const quotaLive = Boolean(quotaUpdatedAt) && hasCompleteQuotaData(quotaSnapshot, quotaTrends);
  const completedAt = new Date().toISOString();
  const modelUpdatedAt = completeModels ? completedAt : null;
  const successfulSourceCount = Number(Boolean(codexResets)) + Number(quotaLive) + Number(completeModels);
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
        name: "LLM Stats · 模型",
        url: LLM_STATS_SITE,
        status: completeModels ? "live" : "unavailable",
        lastSuccessAt: completeModels ? completedAt : null,
        dataUpdatedAt: modelUpdatedAt,
        fallback: false,
        stale: !completeModels,
        detail: completeModels
          ? `完整 ${llmStatsModels.length} 个模型已成功读取。`
          : `模型数据不完整（${modelTrends.length}/${llmStatsModels.length}），不会覆盖完整快照。`,
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
    modelTrends: completeModels ? modelTrends : [],
  };

  return Response.json(briefing, {
    status: successfulSourceCount ? 200 : 502,
    headers: {
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
      "X-Briefing-Started-At": startedAt,
    },
  });
}
