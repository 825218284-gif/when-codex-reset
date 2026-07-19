import type {
  BriefingData,
  BriefingItem,
  ModelRow,
  Priority,
  SourceInfo,
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
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function tidyNumber(value: number | null, digits = 1): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}

function formatModelName(model: unknown, effort: unknown, fallback: string) {
  const normalized = asString(model)
    .replace(/^gpt-/i, "GPT-")
    .replace(/-(sol|terra|luna)$/i, (_, family: string) => ` ${family[0].toUpperCase()}${family.slice(1).toLowerCase()}`);
  const reasoning = asString(effort);
  return normalized ? `${normalized}${reasoning ? ` ${reasoning}` : ""}` : fallback;
}

function sourceStatus(ok: boolean): SourceInfo["status"] {
  return ok ? "live" : "unavailable";
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

function htmlToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ).trim();
}

function matchText(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim() ?? "";
}

function parseResetRadar(html: string) {
  const text = htmlToText(html);
  const latest = matchText(
    text,
    /Latest confirmed reset\s+([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}\s+UTC)/i,
  );
  const chance = asNumber(
    matchText(text, /Next 48h reset chance\s+(\d+)%/i),
  );
  const verdict = /\bYES\s*[—-]/i.test(text)
    ? "确认有新的重置信号"
    : /\bNO\s*[—-]/i.test(text)
      ? "暂未确认新的重置"
      : "正在核验重置信号";
  const primary =
    html.match(/href=["'](https:\/\/x\.com\/thsottiaux\/status\/[^"']+)["']/i)?.[1] ??
    RESET_RADAR_SITE;

  return { latest, chance, verdict, primary };
}

function toModelRow(id: string, label: string, entry: UnknownRecord): ModelRow | null {
  const score = asNumber(entry.score);
  if (score === null) return null;

  const rawStatus = asString(entry.status, "neutral");
  const status = ["green", "yellow", "red"].includes(rawStatus)
    ? (rawStatus as ModelRow["status"])
    : "neutral";

  return {
    id,
    name: label,
    effort: asString(entry.reasoning_effort, "—"),
    score: tidyNumber(score) ?? score,
    cost: tidyNumber(asNumber(entry.average_cost_usd), 2),
    time: asString(entry.average_task_time_human, "—"),
    status,
  };
}

function getCardSignal(radar: UnknownRecord) {
  const window = asRecord(radar.window);
  const prediction = asRecord(radar.prediction);
  const searchable = [
    asString(window.title),
    asString(window.scope),
    asString(window.message),
    asString(prediction.summary),
    asString(prediction.summary_en),
  ].join(" ");
  const mentioned = /banked\s*reset|banked|重置卡|发卡/i.test(searchable);

  return {
    mentioned,
    state: mentioned ? "有重置卡线索" : "未见独立发卡线索",
    detail: mentioned
      ? "公开摘要提到 Banked Reset / 重置卡相关线索；是否新发、可用张数和到期时间仍须在你的账户内确认。"
      : "公开摘要未给出独立发卡确认。个人的卡余额与到期日只能在 Codex 设置中查看。",
  };
}

function priorityForWindow(isOpen: boolean, status: string): Priority {
  if (isOpen) return "critical";
  return status === "community_confirmed" ? "high" : "normal";
}

function makeRadarItems(radar: UnknownRecord, reset: ReturnType<typeof parseResetRadar> | null) {
  const items: BriefingItem[] = [];
  const window = asRecord(radar.window);
  const prediction = asRecord(radar.prediction);
  const modelIq = asRecord(radar.model_iq);
  const quotaRadar = asRecord(modelIq.quota_radar);
  const resetOpen = window.open === true;
  const radarStatus = asString(radar.status);
  const windowTitle = asString(window.title, "Codex 重置状态");
  const windowScope = asString(window.scope, "公开状态范围");
  const latestModel = asRecord(modelIq.latest);
  const topModel = toModelRow(
    "latest",
    formatModelName(latestModel.model, latestModel.reasoning_effort, "当前最高分配置"),
    latestModel,
  );
  const cardSignal = getCardSignal(radar);

  items.push({
    id: "reset-window",
    topic: "reset",
    priority: priorityForWindow(resetOpen, radarStatus),
    source: "Codex 雷达",
    sourceUrl: asString(window.source_url, CODEX_RADAR_SITE),
    confidence: radarStatus === "community_confirmed" ? "社区确认" : "公开状态",
    title: resetOpen ? "出现可关注的重置窗口" : windowTitle,
    detail: resetOpen
      ? `公开状态显示该窗口已开启，影响范围：${windowScope}。`
      : "公开状态显示当前没有开放中的官方重置窗口；个人滚动限额仍应以 Codex 设置页为准。",
    action: resetOpen ? "打开原始来源确认适用范围" : "需要时检查自己的限额和重置卡",
    updatedAt: asString(radar.monitored_at),
  });

  const chance48h = asNumber(prediction.probability_48h);
  if (chance48h !== null) {
    items.push({
      id: "reset-probability",
      topic: "reset",
      priority: chance48h >= 0.6 ? "high" : "low",
      source: "Codex 雷达",
      sourceUrl: CODEX_RADAR_SITE,
      confidence: "趋势判断",
      title: `未来 48 小时重置关注度 ${Math.round(chance48h * 100)}%`,
      detail: "这是公开信号归纳，不是 OpenAI 的承诺，也不能替代账户内的实际限额信息。",
      action: chance48h >= 0.6 ? "关注原始公告" : "无需因预测改变工作安排",
      updatedAt: asString(prediction.updated_at),
    });
  }

  items.push({
    id: "banked-reset-card",
    topic: "card",
    priority: cardSignal.mentioned ? "high" : "normal",
    source: "Codex 雷达",
    sourceUrl: CODEX_RADAR_SITE,
    confidence: cardSignal.mentioned ? "公开摘要线索" : "账户内核验必需",
    title: `发卡 / 重置卡：${cardSignal.state}`,
    detail: cardSignal.detail,
    action: "在 Codex 的“设置 → 剩余用量 → 可用重置次数”查看自己的卡与到期日",
    updatedAt: asString(radar.monitored_at),
  });

  const quotaRows = Array.isArray(quotaRadar.rows) ? quotaRadar.rows : [];
  const quotaSummary = quotaRows
    .map((row) => {
      const item = asRecord(row);
      const tier = asString(item.tier);
      const amount = asNumber(item.seven_d);
      return tier && amount !== null ? `${tier} $${amount.toLocaleString("en-US")}` : "";
    })
    .filter(Boolean)
    .join(" · ");
  if (quotaSummary) {
    items.push({
      id: "quota-observation",
      topic: "quota",
      priority: "normal",
      source: "Codex 雷达",
      sourceUrl: CODEX_RADAR_SITE,
      confidence: "公开额度观测",
      title: `7 天额度观测：${asString(quotaRadar.basis_window_label, "7d")}`,
      detail: quotaSummary,
      action: "将其作为容量趋势参考，不当作个人余额",
      updatedAt: asString(quotaRadar.updated_at),
    });
  }

  if (topModel) {
    items.push({
      id: "top-model",
      topic: "model",
      priority: "normal",
      source: "Codex 雷达",
      sourceUrl: CODEX_RADAR_SITE,
      confidence: "分布式测量",
      title: `${topModel.name} 当前综合分 ${topModel.score}`,
      detail: `推理强度：${topModel.effort}；单任务平均成本约 $${topModel.cost ?? "—"}，平均耗时 ${topModel.time}。`,
      action: "在你的真实任务上先用小样本验证",
      updatedAt: asString(modelIq.updated_at),
    });
  }

  if (reset) {
    const latestText = reset.latest ? `最后一次确认时间：${reset.latest}。` : "页面未能解析到最后一次确认时间。";
    items.push({
      id: "reset-verification",
      topic: "reset",
      priority: reset.verdict.includes("确认有") ? "critical" : "normal",
      source: "Codex Reset Radar",
      sourceUrl: reset.primary,
      confidence: "原始来源核验",
      title: `重置核验：${reset.verdict}`,
      detail: `${latestText}${reset.chance !== null ? ` 该站显示未来 48 小时关注度 ${reset.chance}%。` : ""}`,
      action: "查看原始帖文，而非仅凭汇总站下结论",
    });
  }

  return items;
}

function makeModels(radar: UnknownRecord) {
  const modelIq = asRecord(radar.model_iq);
  const latest = asRecord(modelIq.latest);
  const comparison = asRecord(modelIq.comparisons);
  const models: ModelRow[] = [];

  const first = toModelRow(
    "latest",
    formatModelName(latest.model, latest.reasoning_effort, "当前最高分配置"),
    latest,
  );
  if (first) models.push(first);

  for (const [id, raw] of Object.entries(comparison)) {
    const entry = asRecord(raw);
    const actual = asRecord(entry.latest);
    const label = asString(entry.label, formatModelName(actual.model, actual.reasoning_effort, id));
    const row = toModelRow(id, label, actual);
    if (row) models.push(row);
  }

  return models.sort((a, b) => b.score - a.score).slice(0, 10);
}

function makeBriefing(radar: UnknownRecord | null, reset: ReturnType<typeof parseResetRadar> | null): BriefingData {
  const sources: SourceInfo[] = [
    {
      name: "Codex 雷达",
      url: CODEX_RADAR_SITE,
      attribution: "数据来自 Codex 雷达 codexradar.com",
      status: sourceStatus(Boolean(radar)),
    },
    {
      name: "Codex Reset Radar",
      url: RESET_RADAR_SITE,
      status: sourceStatus(Boolean(reset)),
    },
  ];

  const models = radar ? makeModels(radar) : [];
  const bestModel = models[0] ?? null;
  const bestValue =
    models
      .filter((model) => model.cost !== null && model.score > 0)
      .sort((a, b) => (a.cost! / a.score) - (b.cost! / b.score))[0] ?? null;
  const modelIq = radar ? asRecord(radar.model_iq) : {};
  const quotaRadar = asRecord(modelIq.quota_radar);
  const quotaRows = (Array.isArray(quotaRadar.rows) ? quotaRadar.rows : [])
    .map((row) => {
      const item = asRecord(row);
      return {
        tier: asString(item.tier, "未标注档位"),
        amount: tidyNumber(asNumber(item.seven_d), 2),
        window: asString(item.basis, asString(quotaRadar.basis_window_label, "7d")),
      };
    })
    .filter((row) => row.amount !== null);

  const window = radar ? asRecord(radar.window) : {};
  const prediction = radar ? asRecord(radar.prediction) : {};
  const resetOpen = window.open === true;
  const cardSignal = radar ? getCardSignal(radar) : null;
  const resetState = resetOpen
    ? "关注中"
    : reset?.verdict ??
      (radar ? "暂无公开窗口" : "等待来源响应");
  const resetDetail = resetOpen
    ? "公开状态显示有窗口正在进行。"
    : reset?.latest
      ? `最近核验：${reset.latest}`
      : "仅保留可追溯的公开来源。";

  return {
    generatedAt: new Date().toISOString(),
    sources,
    summary: {
      resetState,
      resetDetail,
      resetChance48h:
        reset?.chance ??
        (() => {
          const chance = asNumber(prediction.probability_48h);
          return chance === null ? null : Math.round(chance * 100);
        })(),
      cardState: cardSignal?.state ?? "等待来源响应",
      cardDetail: cardSignal?.detail ?? "个人卡余额和到期日仅能在 Codex 设置中查看。",
      bestModel,
      bestValue,
      quotaRows,
    },
    items: radar ? makeRadarItems(radar, reset) : reset ? makeRadarItems({}, reset) : [],
    models,
  };
}

export async function GET() {
  const [radarResult, resetResult] = await Promise.allSettled([
    fetch(CODEX_RADAR_API, {
      headers: { accept: "application/json" },
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Codex 雷达返回 ${response.status}`);
      return (await response.json()) as UnknownRecord;
    }),
    fetch(RESET_RADAR_SITE, {
      headers: {
        accept: "text/html",
        "user-agent": "Codex-Update-Filter/1.0 (public-source summary)",
      },
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Reset Radar 返回 ${response.status}`);
      return parseResetRadar(await response.text());
    }),
  ]);

  const radar = radarResult.status === "fulfilled" ? radarResult.value : null;
  const reset = resetResult.status === "fulfilled" ? resetResult.value : null;
  const briefing = makeBriefing(radar, reset);

  return Response.json(briefing, {
    status: radar || reset ? 200 : 502,
    headers: {
      "Cache-Control": "public, max-age=120, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
