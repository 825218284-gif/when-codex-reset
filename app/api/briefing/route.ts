import type {
  HardResetEvent,
  ModelTrendPoint,
  ModelTrendSeries,
  QuotaSnapshotRow,
  QuotaTrendSeries,
  ResetBriefing,
  TrendPoint,
} from "../../lib/briefing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const CODEX_RADAR_API = "https://codexradar.com/current.json";
const CODEX_RADAR_SITE = "https://codexradar.com/";
const CODEX_RESETS_SITE = "https://codex-resets.com/";

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

function parseCodexResets(html: string) {
  const history: HardResetEvent[] = [];
  const items = html.matchAll(/<li\b[^>]*class=["'][^"']*\blog-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi);

  for (const [index, item] of [...items].entries()) {
    const body = item[1];
    const occurredAt = body.match(/data-datetime=["']([^"']+)["']/i)?.[1];
    const sourceUrl = [...body.matchAll(/<a\b([^>]*)>/gi)]
      .find((anchor) => /class=["'][^"']*\blog-item-link\b/i.test(anchor[1]))?.[1]
      ?.match(/href=["']([^"']+)["']/i)?.[1] ?? CODEX_RESETS_SITE;
    const text = body.match(/<p\b[^>]*class=["'][^"']*\blog-item-text\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1];
    if (!occurredAt || !text) continue;
    history.push({
      id: sourceUrl.split("/").at(-1) || `reset-${index + 1}`,
      date: formatResetTimelineTime(occurredAt),
      title: resetTitle(text),
      sourceUrl,
    });
  }

  const hero = html.match(/<span\b[^>]*class=["'][^"']*\bhero-figure\b[^"']*["'][^>]*>/i)?.[0] ?? "";
  const lastResetAt = hero.match(/data-datetime=["']([^"']+)["']/i)?.[1] ?? null;
  const generatedNode = html.match(/<[^>]*data-role=["']generated-at["'][^>]*>/i)?.[0] ?? "";
  const generatedAt = generatedNode.match(/data-datetime=["']([^"']+)["']/i)?.[1] ?? null;
  const totalResets = asNumber(html.match(/<dt>\s*Total resets\s*<\/dt>[\s\S]*?<dd[^>]*>\s*(\d+)/i)?.[1]) ?? history.length;
  const latest = history[0];

  return {
    generatedAt,
    history,
    totalResets,
    verdict: latest ? "最近一次额度重置已记录" : "正在读取额度重置记录",
    latestConfirmed: latest
      ? { title: latest.title, occurredAt: lastResetAt, sourceUrl: latest.sourceUrl }
      : null,
  };
}

function formatModelName(model: unknown, effort: unknown, fallback: string) {
  const family = asString(model)
    .replace(/^gpt-/i, "GPT-")
    .replace(/-(sol|terra|luna)$/i, (_, name: string) => ` ${name[0].toUpperCase()}${name.slice(1).toLowerCase()}`);
  const reasoning = asString(effort);
  return family ? `${family}${reasoning ? ` ${reasoning}` : ""}` : fallback;
}

function modelPoint(raw: UnknownRecord): ModelTrendPoint | null {
  const at = asString(raw.date);
  if (!at) return null;
  const score = asNumber(raw.score);
  const cost = asNumber(raw.average_cost_usd);
  return {
    at,
    score,
    cost,
    value: score !== null && cost !== null && cost > 0 ? score / cost : null,
    duration: asString(raw.average_task_time_human) || null,
  };
}

function modelSeries(id: string, label: string, days: unknown, latest: UnknownRecord): ModelTrendSeries | null {
  const points = (Array.isArray(days) ? days : [])
    .map((day) => modelPoint(asRecord(day)))
    .filter((point): point is ModelTrendPoint => point !== null);
  const current = modelPoint(latest);
  if (current) {
    const index = points.findIndex((point) => point.at === current.at);
    if (index >= 0) points[index] = current;
    else points.push(current);
  }
  points.sort((a, b) => a.at.localeCompare(b.at));
  return points.length ? { id, label, points } : null;
}

function collectModelTrends(radar: UnknownRecord): ModelTrendSeries[] {
  const modelIq = asRecord(radar.model_iq);
  const latest = asRecord(modelIq.latest);
  const items: ModelTrendSeries[] = [];
  const primary = modelSeries(
    "gpt_56_sol_max",
    formatModelName(latest.model, latest.reasoning_effort, "当前最高分配置"),
    modelIq.recent_days,
    latest,
  );
  if (primary) items.push(primary);

  const comparisons = asRecord(modelIq.comparisons);
  for (const [id, raw] of Object.entries(comparisons)) {
    const entry = asRecord(raw);
    const current = asRecord(entry.latest);
    const label = asString(entry.label, formatModelName(current.model, current.reasoning_effort, id));
    const series = modelSeries(id, label, entry.recent_days, current);
    if (series) items.push(series);
  }

  const order = [
    "gpt_56_sol_max",
    "gpt_56_sol_xhigh",
    "gpt_56_sol_high",
    "gpt_56_sol_medium",
    "gpt_56_sol_low",
    "gpt_56_terra_max",
    "gpt_56_terra_high",
    "gpt_56_luna_max",
    "gpt_56_luna_high",
    "gpt_55_high_distributed",
  ];
  return items.sort((a, b) => {
    const aRank = order.indexOf(a.id);
    const bRank = order.indexOf(b.id);
    return (aRank < 0 ? Number.MAX_SAFE_INTEGER : aRank) - (bRank < 0 ? Number.MAX_SAFE_INTEGER : bRank)
      || a.label.localeCompare(b.label);
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

export async function GET() {
  const [resetResult, codexResult] = await Promise.allSettled([
    fetch(CODEX_RESETS_SITE, {
      headers: {
        accept: "text/html",
        "user-agent": "Codex-Reset-Timeline/1.0 (source mirror)",
      },
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Codex Resets returned ${response.status}`);
      return parseCodexResets(await response.text());
    }),
    fetch(CODEX_RADAR_API, {
      headers: { accept: "application/json" },
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Codex Radar returned ${response.status}`);
      return (await response.json()) as UnknownRecord;
    }),
  ]);

  const codexResets = resetResult.status === "fulfilled" ? resetResult.value : null;
  const codexRadar = codexResult.status === "fulfilled" ? codexResult.value : null;
  const briefing: ResetBriefing = {
    generatedAt: codexResets?.generatedAt ?? new Date().toISOString(),
    sources: [
      { name: "Codex Resets", url: CODEX_RESETS_SITE, status: codexResets ? "live" : "unavailable" },
      { name: "Codex 雷达", url: CODEX_RADAR_SITE, status: codexRadar ? "live" : "unavailable" },
    ],
    verdict: codexResets?.verdict ?? "暂时无法核验",
    verdictDetail: codexResets
      ? `Codex Resets 已记录 ${codexResets.totalResets} 次额度重置；按 @thsottiaux 的 X 公告自动分类。`
      : "请稍后刷新，或直接打开来源站点。",
    probability48h: null,
    probabilitySource: "Codex Resets 未提供未来 48 小时重置概率",
    latestConfirmed: codexResets?.latestConfirmed ?? null,
    history: codexResets?.history ?? [],
    quotaUpdatedAt: codexRadar
      ? asString(asRecord(asRecord(codexRadar.model_iq).quota_radar).updated_at) || null
      : null,
    quotaSnapshot: codexRadar ? collectQuotaSnapshot(codexRadar) : [],
    quotaTrends: codexRadar ? collectQuotaTrends(codexRadar) : [],
    modelUpdatedAt: codexRadar
      ? asString(asRecord(asRecord(codexRadar.model_iq).latest).date) || null
      : null,
    modelTrends: codexRadar ? collectModelTrends(codexRadar) : [],
  };

  return Response.json(briefing, {
    status: codexResets || codexRadar ? 200 : 502,
    headers: {
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
