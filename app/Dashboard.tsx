"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ModelTrendPoint, ModelTrendSeries, ResetBriefing, TrendPoint } from "./lib/briefing";

const CODEX_RESETS_URL = "https://codex-resets.com/";
const CODEX_RADAR_CURRENT_URL = "https://codexradar.com/current.json";
const CODEX_RADAR_INTELLIGENCE_URL = "https://codexradar.com/data/intelligence-efficiency.json";

type FreshnessState = "fresh" | "stale" | "cached" | "unavailable" | "loading";

type ExtendedSource = ResetBriefing["sources"][number] & {
  cached?: boolean;
  fallbackUsed?: boolean;
  freshness?: string;
  lastSuccessAt?: string | null;
};

function freshnessState(
  data: ResetBriefing | null,
  updatedAt: string | null | undefined,
  sourceKey?: "reset" | "quota" | "model",
  staleAfterHours = 6,
): FreshnessState {
  if (!data) return "loading";
  const legacyName = sourceKey === "reset" ? "reset" : "radar";
  const legacySources = data.sources.filter((candidate) => candidate.name.toLowerCase().includes(legacyName));
  const source: ExtendedSource | undefined = sourceKey
    ? (data.sources.find((candidate) => candidate.key === sourceKey)
      ?? (sourceKey === "reset" ? legacySources[0] : legacySources.at(-1))) as ExtendedSource | undefined
    : undefined;
  const sourceStatus = source?.status ? String(source.status).toLowerCase() : "";
  const sourceFreshness = source?.freshness?.toLowerCase() ?? "";
  if (sourceStatus === "unavailable") return "unavailable";
  if (source?.fallback || source?.fallbackUsed || source?.cached || sourceStatus === "fallback" || sourceStatus === "cached" || sourceFreshness === "cached") return "cached";
  if (source?.stale || sourceStatus === "stale" || sourceFreshness === "stale") return "stale";

  const timestamp = sourceKey === "reset"
    ? source?.lastSuccessAt ?? updatedAt
    : source?.dataUpdatedAt ?? source?.lastSuccessAt ?? updatedAt;
  if (!timestamp) return "unavailable";
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "cached";
  return Date.now() - parsed.getTime() > staleAfterHours * 60 * 60 * 1000 ? "stale" : "fresh";
}

function freshnessLabel(state: FreshnessState) {
  return {
    fresh: "数据新鲜",
    stale: "数据陈旧",
    cached: "使用缓存",
    unavailable: "来源暂不可用",
    loading: "正在读取",
  }[state];
}

function freshnessHours(sourceKey: "reset" | "quota" | "model" | undefined) {
  if (sourceKey === "reset") return 3;
  if (sourceKey === "quota") return 24;
  return 6;
}

function sourceIndicatorClass(state: FreshnessState) {
  if (state === "fresh") return "live";
  if (state === "cached") return "fallback";
  return state;
}

function DataStatus({ state }: { state: FreshnessState }) {
  return <span className={`data-status is-${state}`}>{freshnessLabel(state)}</span>;
}

function briefingUrl() {
  const staticUrl = typeof document === "undefined"
    ? ""
    : document.getElementById("root")?.dataset.briefingUrl ?? "";
  const baseUrl = staticUrl || "/api/briefing";
  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}refresh=${Date.now()}`;
}

function modelColor(id: string) {
  if (id.startsWith("gpt_6_astra_ultra") || id.startsWith("gpt_6_astra_max") || id.startsWith("gpt_6_astra_xhigh")) return "#35d6ee";
  if (id.startsWith("gpt_6_astra_")) return "#0e93a8";
  if (id.includes("_sol_ultra") || id.includes("_sol_max") || id.includes("_sol_xhigh")) return "#f5c518";
  if (id.includes("_sol_high")) return "#e98500";
  if (id.includes("_sol_medium")) return "#a64b16";
  if (id.includes("_sol_low")) return "#804016";
  if (id.includes("_luna_max") || id.includes("_luna_xhigh")) return "#ff6f8a";
  if (id.includes("_luna_high") || id.includes("_luna_medium") || id.includes("_luna_low")) return "#e61f4d";
  if (id.startsWith("glm_5_3_flash_max")) return "#b39cff";
  if (id.startsWith("glm_5_3_flash_")) return "#7f57e0";
  return "#806ef2";
}

function shortModelLabel(label: string) {
  return label.replace(/^(?:GPT-(?:5\.6|6)|GLM 5\.3)\s+/i, "");
}

function latestModelPoint(series: ModelTrendSeries): ModelTrendPoint | null {
  return series.points.at(-1) ?? null;
}

function formatBeijing(value: string | null | undefined) {
  if (!value) return { date: "时间待来源补全", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: value, time: "" };
  const [datePart, timePart] = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date).replace(/\//g, ".").split(/\s+/);
  return { date: datePart ?? "时间待来源补全", time: timePart ?? "" };
}

function formatSourceUpdatedAt(value?: string | null) {
  if (!value) return "正在读取";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚整理";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatChartDate(value: string) {
  const quotaMatch = value.match(/^\d{4}-(\d{2})-(\d{2})(?:-(am|pm))?$/i);
  if (quotaMatch) {
    const period = quotaMatch[3] ? ` ${quotaMatch[3].toUpperCase()}` : "";
    return `${Number(quotaMatch[1])}/${Number(quotaMatch[2])}${period}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function formatResetTimelineDate(value: string) {
  const match = value.match(/(?:\d{4}[./-])?(\d{1,2})[./-](\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/);
  if (match) {
    return {
      day: `${Number(match[1])}/${Number(match[2])}`,
      minute: match[3] ?? "",
    };
  }
  return { day: value, minute: "" };
}

function formatValue(value: number, unit: string) {
  if (unit.startsWith("USD")) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return value.toFixed(1);
}

function formatCardCost(value: number | null) {
  if (value === null) return "—";
  return `$${value.toFixed(Math.abs(value) < 0.1 ? 3 : 1)}`;
}

function formatSignedValue(value: number, unit: string) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatValue(Math.abs(value), unit)}`;
}

function SourceCaption({ href, label }: { href: string; label: string }) {
  return (
    <p className="source-caption">
      数据来源：<a href={href} target="_blank" rel="noreferrer">{label} ↗</a>
    </p>
  );
}

function CurveChart({
  title,
  points,
  unit,
  color,
}: {
  title: string;
  points: TrendPoint[];
  unit: string;
  color: string;
}) {
  const width = 760;
  const height = 224;
  // Reserve enough SVG space for four-digit currency tick labels on narrow screens.
  const left = 72;
  const right = 18;
  const top = 14;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const valid = points
    .map((point, index) => ({ ...point, index }))
    .filter((point): point is TrendPoint & { index: number; value: number } => point.value !== null);
  const values = valid.map((point) => point.value);
  const baseMin = values.length ? Math.min(...values) : 0;
  const baseMax = values.length ? Math.max(...values) : 1;
  const spread = Math.max(baseMax - baseMin, Math.abs(baseMax) * 0.08, 1);
  const min = baseMin - spread * 0.14;
  const max = baseMax + spread * 0.14;
  const x = (index: number) =>
    points.length <= 1 ? left + plotWidth / 2 : left + (index / (points.length - 1)) * plotWidth;
  const y = (value: number) => top + ((max - value) / (max - min)) * plotHeight;
  const path = points.reduce((accumulator, point, index) => {
    if (point.value === null) return { value: accumulator.value, gap: true };
    const command = accumulator.gap ? "M" : "L";
    return { value: `${accumulator.value}${command}${x(index).toFixed(2)},${y(point.value).toFixed(2)} `, gap: false };
  }, { value: "", gap: true }).value;
  const yTicks = [0, 1, 2, 3].map((index) => max - ((max - min) * index) / 3);
  const xIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), Math.max(points.length - 1, 0)])];
  const latest = valid.at(-1);
  const chartStyle = { "--curve-color": color } as CSSProperties;

  return (
    <figure className="curve-figure" style={chartStyle}>
      <figcaption>
        <span>{unit}</span>
        <strong>{latest ? formatValue(latest.value, unit) : "—"}</strong>
        <small>{latest ? formatChartDate(latest.at) : "等待公开数据"}</small>
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} 曲线，单位 ${unit}`}>
        <title>{title}</title>
        <desc>显示来源公开数据随时间的变化。最新可用值为 {latest ? formatValue(latest.value, unit) : "暂无"}。</desc>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="curve-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
            <text className="curve-y-label" x={left - 9} y={y(tick) + 4} textAnchor="end">
              {formatValue(tick, unit)}
            </text>
          </g>
        ))}
        <line className="curve-axis" x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} />
        {xIndexes.map((index) => (
          <text className="curve-x-label" key={index} x={x(index)} y={height - 11} textAnchor="middle">
            {points[index] ? formatChartDate(points[index].at) : ""}
          </text>
        ))}
        {path ? <path className="curve-line" d={path} /> : null}
        {valid.map((point) => (
          <circle className="curve-dot" cx={x(point.index)} cy={y(point.value)} r="3.6" key={`${point.at}-${point.index}`} />
        ))}
        {latest ? (
          <text
            className="curve-end-label"
            x={x(latest.index) > width - 102 ? x(latest.index) - 8 : x(latest.index) + 8}
            y={Math.max(y(latest.value) - 10, 14)}
            textAnchor={x(latest.index) > width - 102 ? "end" : "start"}
          >
            {formatValue(latest.value, unit)}
          </text>
        ) : null}
      </svg>
    </figure>
  );
}

function ModelCard({ series }: { series: ModelTrendSeries }) {
  const latest = latestModelPoint(series);
  const color = modelColor(series.id);
  const label = shortModelLabel(series.label);
  const score = latest?.score === null || latest?.score === undefined ? "—" : formatValue(latest.score, "IQ");
  const price = formatCardCost(latest?.cost ?? null);
  const duration = latest?.duration ?? "时间待来源补全";
  const value = latest?.value === null || latest?.value === undefined
    ? "—"
    : `${formatValue(latest.value, "IQ / USD")} IQ/$`;

  return (
    <article className="model-card" style={{ "--model-color": color } as CSSProperties}>
      <span className="model-card-main">
        <span className="model-card-label">{label}</span>
        <strong className="model-card-score">{score}</strong>
      </span>
      <span className="model-card-meta">
        <b>{price}</b>
        <small>{duration}</small>
        <small>{value}</small>
      </span>
    </article>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<ResetBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(briefingUrl(), { cache: "no-store" });
      const next = (await response.json()) as ResetBriefing;
      if (!response.ok) throw new Error("source unavailable");
      setData(next);
    } catch {
      setError("暂时无法读取公开信号，请稍后刷新或直接打开来源站点。 ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  const quota = data?.quotaTrends.find((series) => series.id === "pro20-7d") ?? data?.quotaTrends[0];
  const modelTrends = data?.modelTrends ?? [];
  const latestResetTime = formatBeijing(data?.latestConfirmed?.occurredAt);
  const requestFailureState: FreshnessState | null = error ? (data ? "cached" : "unavailable") : null;
  const resetFreshness = requestFailureState ?? freshnessState(data, data?.generatedAt, "reset", 3);
  const quotaFreshness = requestFailureState ?? freshnessState(data, data?.quotaUpdatedAt, "quota", 24);
  const modelFreshness = requestFailureState ?? freshnessState(data, data?.modelUpdatedAt, "model", 6);
  const quotaSummary = useMemo(() => {
    if (!quota) return null;
    const valid = quota.points.filter(
      (point): point is TrendPoint & { value: number } => point.value !== null,
    );
    const previous = valid.at(-2) ?? valid[0];
    const latest = valid.at(-1);
    if (!previous || !latest) return null;
    const delta = latest.value - previous.value;
    return {
      previous: previous.value,
      latest: latest.value,
      delta,
      percent: previous.value === 0 ? null : (delta / previous.value) * 100,
    };
  }, [quota]);

  return (
    <main>
      <div className="halo halo-top" />
      <div className="halo halo-bottom" />
      <div className="shell">
        <nav className="topbar" aria-label="主导航">
          <a className="brand" href="#top">
            <span className="brand-signal" aria-hidden="true"><i /><i /><i /></span>
            <h1>Codex 重置雷达</h1>
          </a>
          <div className="refresh-area">
            <button className="refresh" onClick={() => void refresh()} disabled={loading}>
              <span aria-hidden="true">↻</span>
              {loading ? "读取中" : "重新读取"}
            </button>
            <small>读取最近发布快照；目标每小时自动检查，实际时间可能受调度影响</small>
          </div>
        </nav>

        <section className="signal-panel" id="top" aria-label="最近一次重置">
          <article className="latest-card">
            <div className="signal-label">
              <p>最近一次重置</p>
              <DataStatus state={resetFreshness} />
            </div>
            <strong className="latest-reset-time">
              <span>{latestResetTime.date}</span>
              {latestResetTime.time ? <span>{latestResetTime.time}</span> : null}
            </strong>
            <span className="latest-timezone">北京时间</span>
            {data?.latestConfirmed ? (
              <a href={data.latestConfirmed.sourceUrl} target="_blank" rel="noreferrer">查看原始来源 ↗</a>
            ) : null}
          </article>
        </section>
        <SourceCaption href={CODEX_RESETS_URL} label="Codex Resets" />

        {error ? <p className="error-message">{error}</p> : null}

        <section className="timeline-section" aria-labelledby="timeline-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">CONFIRMED HISTORY</p>
                <h2 id="timeline-title">额度重置时间轴</h2>
              </div>
              <div className="timeline-heading-actions">
                <DataStatus state={resetFreshness} />
                <a
                  className="timeline-latest-link"
                  href={data?.history[0]?.sourceUrl ?? CODEX_RESETS_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  最新记录 ↗
                </a>
              </div>
            </div>

            {loading && !data ? <div className="timeline-loading"><i /><i /><i /></div> : null}
            {!loading && !data?.history.length ? <div className="empty-state">暂未读取到可展示的额度重置历史。</div> : null}
            <ol className="timeline">
              {data?.history.slice(0, 4).map((event, index) => {
                const resetTime = formatResetTimelineDate(event.date);
                return (
                  <li className={index === 0 ? "is-latest" : ""} key={event.id}>
                    <div className="timeline-node" aria-hidden="true"><span /></div>
                    <time aria-label={`额度重置：${event.date}`}>
                      <strong>{resetTime.day}</strong>
                      {index === 0 && resetTime.minute ? <small>{resetTime.minute}</small> : null}
                    </time>
                  </li>
                );
              })}
            </ol>
            <SourceCaption href={CODEX_RESETS_URL} label="Codex Resets" />
        </section>

        <section className="chart-section" aria-labelledby="quota-title">
          <div className="section-heading chart-heading">
            <div>
              <p className="eyebrow">PUBLIC QUOTA TREND</p>
              <h2 id="quota-title">额度雷达</h2>
            </div>
            <div className="heading-status">
              <span>{formatSourceUpdatedAt(data?.quotaUpdatedAt)} 更新</span>
              <DataStatus state={quotaFreshness} />
            </div>
          </div>
          <div className="quota-card">
            <div className="quota-card-heading">
              <div>
                <h3>公开 7d 额度</h3>
                <p>当前公开观测快照</p>
              </div>
              <span>不代表个人剩余额度</span>
            </div>
            <div className="quota-table-wrap">
              <table className="quota-table">
                <thead>
                  <tr>
                    <th scope="col">档位</th>
                    <th scope="col">7d 额度</th>
                    <th scope="col">来源</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.quotaSnapshot.map((row) => (
                    <tr key={row.tier}>
                      <th scope="row" data-label="档位">{row.tier}</th>
                      <td data-label="7d 额度">{row.sevenDayQuota === null ? "—" : formatValue(row.sevenDayQuota, "USD / 7d")}</td>
                      <td data-label="来源"><a href={CODEX_RADAR_CURRENT_URL} target="_blank" rel="noreferrer">{row.basis} ↗</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="quota-curve-heading">
            <h3>20x Pro · 7d 额度变化</h3>
            {quotaSummary ? (
              <span className={quotaSummary.delta >= 0 ? "is-up" : "is-down"}>
                {formatValue(quotaSummary.previous, "USD / 7d")} → {formatValue(quotaSummary.latest, "USD / 7d")} ({formatSignedValue(quotaSummary.delta, "USD / 7d")}{quotaSummary.percent === null ? "" : `，${quotaSummary.percent > 0 ? "+" : ""}${quotaSummary.percent.toFixed(1)}%`})
              </span>
            ) : null}
          </div>
          {quota ? <CurveChart title={`${quota.label} 额度变化`} points={quota.points} unit={quota.unit} color="#49c5a1" /> : <div className="empty-state">等待额度趋势数据。</div>}
          <p className="chart-note">仅展示一条可持续读取的 20x Pro 7d 公开曲线。</p>
          <SourceCaption href={CODEX_RADAR_CURRENT_URL} label="Codex Radar · current.json" />
        </section>

        <section className="chart-section model-section" aria-labelledby="model-title">
          <div className="section-heading chart-heading">
            <div>
              <p className="eyebrow">MODEL INTELLIGENCE</p>
              <h2 id="model-title">模型 IQ、价格与性价比</h2>
            </div>
            <div className="heading-status">
              <span>{formatSourceUpdatedAt(data?.modelUpdatedAt)} 更新</span>
              <DataStatus state={modelFreshness} />
            </div>
          </div>
          <p className="model-intro">每张卡片是一种公开测量配置，展示其 IQ、单任务平均价格、平均耗时和性价比。</p>
          {modelTrends.length ? (
            <div className="model-card-grid" aria-label="模型配置">
              {modelTrends.map((series) => (
                <ModelCard key={series.id} series={series} />
              ))}
            </div>
          ) : <div className="empty-state">等待模型数据。</div>}
          <p className="chart-note">性价比 = IQ ÷ 单任务平均价格，仅用于同一公开任务集内的相对比较。</p>
          <SourceCaption href={CODEX_RADAR_INTELLIGENCE_URL} label="Codex Radar · intelligence-efficiency.json" />
        </section>

        <footer>
          <p>公开重置记录、额度和模型数据来自页面标注来源；个人账户的滚动限额请以 Codex 设置页为准。</p>
          <p className="footer-status" aria-live="polite">
            页面快照：{formatSourceUpdatedAt(data?.generatedAt)} · 重置 {freshnessLabel(resetFreshness)} · 额度 {freshnessLabel(quotaFreshness)} · 模型 {freshnessLabel(modelFreshness)}
          </p>
          <div>
            {data?.sources.filter((source) => source.name !== "Codex Reset Radar").map((source) => {
              const state = requestFailureState ?? freshnessState(data, source.dataUpdatedAt ?? data.generatedAt, source.key, freshnessHours(source.key));
              return (
                <a href={source.url} target="_blank" rel="noreferrer" key={source.name}>
                  <i className={sourceIndicatorClass(state)} aria-hidden="true" />{source.name} · {freshnessLabel(state)} ↗
                </a>
              );
            })}
          </div>
        </footer>
      </div>
    </main>
  );
}
