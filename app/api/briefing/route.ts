import type { HardResetEvent, ResetBriefing } from "../../lib/briefing";

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
    const match = html.match(candidate)?.[1];
    const value = asNumber(match);
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
      ? {
          title: latest.title,
          occurredAt: resetAt || null,
          sourceUrl: resetSource,
        }
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
  const probability = resetRadar?.probability ?? fallback?.probability ?? null;
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
    probability48h: probability,
    probabilitySource: resetRadar?.probability !== null && resetRadar?.probability !== undefined
      ? "Codex Reset Radar 信号评估"
      : "Codex 雷达公开摘要",
    latestConfirmed: resetRadar?.latestConfirmed ?? null,
    history: resetRadar?.history ?? [],
  };

  return Response.json(briefing, {
    status: resetRadar || codexRadar ? 200 : 502,
    headers: {
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
