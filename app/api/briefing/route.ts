import type {
  HardResetEvent,
  ModelTrendPoint,
  ModelTrendSeries,
  QuotaTrendSeries,
  ResetBriefing,
  TrendPoint,
} from "../../lib/briefing";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const CODEX_RADAR_API = "https://codexradar.com/current.json";
const CODEX_RADAR_SITE = "https://codexradar.com/";
const RESET_RADAR_SITE = "https://codexresetradar.com/";

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

function readEmbeddedNumber(html: string, key: string) {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidates = [
    new RegExp(`"${safeKey}":(\\d+(?:\\.\\d+)?)`),
    new RegExp(String.raw`\\"${safeKey}\\":(\d+(?:\.\d+)?)`),
  ];
  for (const candidate of candidates) {
    const value = asNumber(html.match(candidate)?.[1]);
    if (value !== null) return value;
  }
  return null;
}

function readEmbeddedString(html: string, key: string) {
  const safeKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const candidates = [
    new RegExp(`"${safeKey}":"([^"\\\\]+)"`),
    new RegExp(String.raw`\\"${safeKey}\\":\\"([^"\\]+)\\"`),
  ];
  for (const candidate of candidates) {
    const value = html.match(candidate)?.[1];
    if (value) return decodeHtml(value);
  }
  return "";
}

function parseHardResetHistory(html: string): HardResetEvent[] {
  const results: HardResetEvent[] = [];
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);

  for (const anchor of anchors) {
    const attributes = anchor[1];
    const body = anchor[2];
    if (!/class=["'][^"']*\bhistory-row\b/i.test(attributes)) continue;

    const date = body.match(/<time[^>]*>([^<]+)<\/time>/i)?.[1]?.trim();
    const title = body.match(/<strong[^>]*>([^<]+)<\/strong>/i)?.[1]?.trim();
    const spans = [...body.matchAll(/<span(?:\s[^>]*)?>([^<]+)<\/span>/gi)].map((match) =>
      plainText(match[1]),
    );
    const kind = spans.at(-1) ?? "";
    const sourceUrl = attributes.match(/href=["']([^"']+)["']/i)?.[1] ?? RESET_RADAR_SITE;

    if (!date || !title || !/hard\s+reset/i.test(kind)) continue;
    results.push({
      id: `${date}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      date,
      title: plainText(title),
      sourceUrl,
    });
  }

  return results;
}

function parseResetRadar(html: string) {
  const history = parseHardResetHistory(html);
  const visibleText = plainText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " "),
  );
  const visibleProbability = asNumber(
    visibleText.match(/Next 48h reset chance\s+(\d+(?:\.\d+)?)%/i)?.[1],
  );
  const probability = readEmbeddedNumber(html, "next48hProbability") ?? visibleProbability;
  const resetAt = readEmbeddedString(html, "resetAt");
  const resetSource = readEmbeddedString(html, "resetSource") || history[0]?.sourceUrl || RESET_RADAR_SITE;
  const latest = history[0];
  const verdict = /\bYES\s*[—-]/i.test(visibleText)
    ? "已确认新的硬重置信号"
    : /\bNO\s*[—-]/i.test(visibleText)
      ? "暂无新的已确认硬重置"
      : "正在核验重置信号";

  return {
    history,
    probability,
    verdict,
    latestConfirmed: latest
      ? { title: latest.title, occurredAt: resetAt || null, sourceUrl: resetSource }
      : null,
  };
}

function makeFallbackFromCodexRadar(radar: UnknownRecord) {
  const window = asRecord(radar.window);
  const prediction = asRecord(radar.prediction);
  const probability = asNumber(prediction.probability_48h);
  const resetOpen = window.open === true;

  return {
    probability: probability === null ? null : Math.round(probability * 100),
    verdict: resetOpen ? "公开窗口显示正在进行" : "暂无开放中的公开重置窗口",
    detail: resetOpen
      ? "请回到原始公告确认适用范围。"
      : "个人滚动限额仍应以 Codex 设置页为准。",
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

  return items.sort((a, b) => a.label.localeCompare(b.label));
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

export async function GET() {
  const [resetResult, codexResult] = await Promise.allSettled([
    fetch(RESET_RADAR_SITE, {
      headers: {
        accept: "text/html",
        "user-agent": "Codex-Reset-Timeline/1.0 (public-source summary)",
      },
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Reset Radar returned ${response.status}`);
      return parseResetRadar(await response.text());
    }),
    fetch(CODEX_RADAR_API, {
      headers: { accept: "application/json" },
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Codex Radar returned ${response.status}`);
      return (await response.json()) as UnknownRecord;
    }),
  ]);

  const resetRadar = resetResult.status === "fulfilled" ? resetResult.value : null;
  const codexRadar = codexResult.status === "fulfilled" ? codexResult.value : null;
  const fallback = codexRadar ? makeFallbackFromCodexRadar(codexRadar) : null;
  const briefing: ResetBriefing = {
    generatedAt: new Date().toISOString(),
    sources: [
      { name: "Codex Reset Radar", url: RESET_RADAR_SITE, status: resetRadar ? "live" : "unavailable" },
      { name: "Codex 雷达", url: CODEX_RADAR_SITE, status: codexRadar ? "live" : "unavailable" },
    ],
    verdict: resetRadar?.verdict ?? fallback?.verdict ?? "暂时无法核验",
    verdictDetail: resetRadar
      ? "只把有可追溯原始来源的事件视为已确认。"
      : fallback?.detail ?? "请稍后刷新，或直接打开来源站点。",
    probability48h: resetRadar?.probability ?? fallback?.probability ?? null,
    probabilitySource:
      resetRadar?.probability !== null && resetRadar?.probability !== undefined
        ? "Codex Reset Radar 信号评估"
        : "Codex 雷达公开摘要",
    latestConfirmed: resetRadar?.latestConfirmed ?? null,
    history: resetRadar?.history ?? [],
    quotaTrends: codexRadar ? collectQuotaTrends(codexRadar) : [],
    modelTrends: codexRadar ? collectModelTrends(codexRadar) : [],
  };

  return Response.json(briefing, {
    status: resetRadar || codexRadar ? 200 : 502,
    headers: {
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
