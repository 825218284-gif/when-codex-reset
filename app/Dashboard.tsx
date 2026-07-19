"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ModelTrendPoint, ModelTrendSeries, ResetBriefing, TrendPoint } from "./lib/briefing";

type ModelMetric = "score" | "cost" | "value";

const metricMeta: Record<ModelMetric, { label: string; unit: string }> = {
  score: { label: "IQ", unit: "IQ" },
  cost: { label: "价格", unit: "USD / 任务" },
  value: { label: "性价比", unit: "IQ / USD" },
};

const CODEX_RESETS_URL = "https://codex-resets.com/";
const RESET_RADAR_URL = "https://codexresetradar.com/";
const CODEX_RADAR_URL = "https://codexradar.com/";

function modelColor(id: string) {
  if (id.includes("_sol_max") || id.includes("_sol_xhigh")) return "#f5c518";
  if (id.includes("_sol_high")) return "#e98500";
  if (id.includes("_sol_medium")) return "#a64b16";
  if (id.includes("_sol_low")) return "#804016";
  if (id.includes("_terra_max")) return "#5b9df1";
  if (id.includes("_terra_high")) return "#2d67e7";
  if (id.includes("_luna_max")) return "#ff6f8a";
  if (id.includes("_luna_high")) return "#e61f4d";
  if (id.includes("gpt_55")) return "#21c66a";
  return "#806ef2";
}

function modelDash(id: string) {
  if (id.endsWith("_max")) return undefined;
  if (id.includes("xhigh")) return "11 5";
  if (id.includes("_high")) return "5 5";
  if (id.includes("_medium")) return "12 4 2 4";
  return "2 6";
}

function shortModelLabel(label: string) {
  return label.replace(/^GPT-5\.6\s+/i, "");
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
  return value === null ? "—" : `$${value.toFixed(1)}`;
}

function formatSignedValue(value: number, unit: string) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatValue(Math.abs(value), unit)}`;
}

function probabilityTone(value: number | null | undefined) {
  if (value === null || value === undefined) return "unknown";
  if (value >= 60) return "high";
  if (value >= 30) return "watch";
  return "calm";
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
  const left = 50;
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

function ModelCard({
  series,
  selected,
  onSelect,
}: {
  series: ModelTrendSeries;
  selected: boolean;
  onSelect: () => void;
}) {
  const latest = latestModelPoint(series);
  const color = modelColor(series.id);
  const label = shortModelLabel(series.label);
  const score = latest?.score === null || latest?.score === undefined ? "—" : formatValue(latest.score, "IQ");
  const price = formatCardCost(latest?.cost ?? null);
  const duration = latest?.duration ?? "时间待来源补全";

  return (
    <button
      className={selected ? "model-card is-selected" : "model-card"}
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={{ "--model-color": color } as CSSProperties}
    >
      <span className="model-card-label">{label}</span>
      <span className="model-card-body">
        <strong>{score}</strong>
        <span>
          <b>{price}</b>
          <small>{duration}</small>
        </span>
      </span>
    </button>
  );
}

type HoveredModelPoint = {
  label: string;
  at: string;
  value: number;
  color: string;
  left: number;
  top: number;
};

function ModelComparisonChart({
  series,
  metric,
  selectedIds,
  onToggle,
}: {
  series: ModelTrendSeries[];
  metric: ModelMetric;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<HoveredModelPoint | null>(null);
  const width = 820;
  const height = 286;
  const left = 54;
  const right = 24;
  const top = 18;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.at)))].sort((a, b) => a.localeCompare(b));
  const values = series.flatMap((item) => item.points.map((point) => point[metric]).filter((value): value is number => value !== null));
  const baseMin = values.length ? Math.min(...values) : 0;
  const baseMax = values.length ? Math.max(...values) : 1;
  const spread = Math.max(baseMax - baseMin, Math.abs(baseMax) * 0.08, 1);
  const min = baseMin - spread * 0.13;
  const max = baseMax + spread * 0.13;
  const x = (index: number) =>
    dates.length <= 1 ? left + plotWidth / 2 : left + (index / (dates.length - 1)) * plotWidth;
  const y = (value: number) => top + ((max - value) / (max - min)) * plotHeight;
  const yTicks = [0, 1, 2, 3].map((index) => max - ((max - min) * index) / 3);
  const xIndexes = [...new Set(Array.from({ length: Math.min(dates.length, 5) }, (_, index) =>
    Math.round((index * Math.max(dates.length - 1, 0)) / Math.max(Math.min(dates.length, 5) - 1, 1)),
  ))];
  const selectedSeries = series.filter((item) => selectedIds.includes(item.id));
  const primarySelectedSeries = selectedSeries[0] ?? series[0];
  const selectedLatest = primarySelectedSeries ? latestModelPoint(primarySelectedSeries) : null;
  const selectedValue = selectedLatest?.[metric] ?? null;
  const selectedLabel = primarySelectedSeries ? shortModelLabel(primarySelectedSeries.label) : "未选择模型";
  const selectedSummary = selectedSeries.length > 1 ? `已选 ${selectedSeries.length} 个模型` : selectedLabel;
  const meta = metricMeta[metric];
  const pathFor = (item: ModelTrendSeries) => {
    const points = new Map(item.points.map((point) => [point.at, point[metric]]));
    return dates.reduce(
      (accumulator, at, index) => {
        const value = points.get(at);
        if (value === null || value === undefined) return { value: accumulator.value, gap: true };
        const command = accumulator.gap ? "M" : "L";
        return {
          value: `${accumulator.value}${command}${x(index).toFixed(2)},${y(value).toFixed(2)} `,
          gap: false,
        };
      },
      { value: "", gap: true },
    ).value;
  };

  return (
    <figure className="model-curve-figure">
      <figcaption>
        <div>
          <span>{meta.label} 曲线</span>
          <strong>{selectedSeries.length > 1 ? `${selectedSeries.length} 个模型` : selectedValue === null ? "—" : formatValue(selectedValue, meta.unit)}</strong>
          <small>{selectedSeries.length > 1 ? "多模型同时对比" : `${selectedLabel} · ${selectedLatest ? formatChartDate(selectedLatest.at) : "等待公开数据"}`}</small>
        </div>
        <p>点选卡片或曲线节点可增减对比模型</p>
      </figcaption>
      <div className="model-curve-canvas" onPointerLeave={() => setHovered(null)}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${meta.label} 多模型对比曲线`}>
          <title>{meta.label} 多模型对比</title>
          <desc>展示 {series.length} 个公开模型配置的 {meta.label} 时间变化。当前选中 {selectedSummary}。</desc>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line className="model-curve-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
              <text className="model-curve-y-label" x={left - 9} y={y(tick) + 4} textAnchor="end">
                {formatValue(tick, meta.unit)}
              </text>
            </g>
          ))}
          <line className="model-curve-axis" x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} />
          {xIndexes.map((index) => (
            <text
              className={
                index === xIndexes[0] || index === xIndexes.at(-1) || index === xIndexes[Math.floor(xIndexes.length / 2)]
                  ? "model-curve-x-label"
                  : "model-curve-x-label is-optional"
              }
              key={dates[index]}
              x={x(index)}
              y={height - 13}
              textAnchor="middle"
            >
              {formatChartDate(dates[index])}
            </text>
          ))}
          {series.map((item) => {
            const selected = selectedIds.includes(item.id);
            const color = modelColor(item.id);
            const renderColor = selected ? color : "#8c989f";
            const path = pathFor(item);
            const dash = modelDash(item.id);
            return (
              <g className={selected ? "model-curve-series is-selected" : "model-curve-series"} key={item.id}>
                {path ? (
                  <path
                    className="model-curve-line"
                    d={path}
                    stroke={renderColor}
                    strokeDasharray={dash}
                  />
                ) : null}
                {item.points.map((point) => {
                  const value = point[metric];
                  const index = dates.indexOf(point.at);
                  if (value === null || index < 0) return null;
                  const pointX = x(index);
                  const pointY = y(value);
                  return (
                    <circle
                      className="model-curve-dot"
                      cx={pointX}
                      cy={pointY}
                      fill={renderColor}
                      r={selected ? 4.3 : 3.1}
                      key={`${item.id}-${point.at}`}
                      onClick={() => onToggle(item.id)}
                      onPointerEnter={() => setHovered({
                        label: shortModelLabel(item.label),
                        at: point.at,
                        value,
                        color: renderColor,
                        left: Math.min(86, Math.max(14, (pointX / width) * 100)),
                        top: Math.min(78, Math.max(12, (pointY / height) * 100)),
                      })}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
        {hovered ? (
          <div className="model-curve-tooltip" style={{ left: `${hovered.left}%`, top: `${hovered.top}%` }} role="status">
            <i style={{ background: hovered.color }} aria-hidden="true" />
            <strong>{hovered.label}</strong>
            <span>{formatChartDate(hovered.at)} · {formatValue(hovered.value, meta.unit)}</span>
          </div>
        ) : null}
      </div>
      <p className="model-curve-detail" aria-live="polite">
        {hovered
          ? `${hovered.label} · ${formatChartDate(hovered.at)} · ${formatValue(hovered.value, meta.unit)}`
          : `已选 ${selectedSeries.length} 个模型；点击卡片或节点可增减对比，至少保留一个模型。`}
      </p>
    </figure>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<ResetBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(["gpt_56_sol_max"]);
  const [metric, setMetric] = useState<ModelMetric>("score");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/briefing", { cache: "no-store" });
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

  const probability = data?.probability48h;
  const tone = probabilityTone(probability);
  const quota = data?.quotaTrends.find((series) => series.id === "pro20-7d") ?? data?.quotaTrends[0];
  const modelTrends = data?.modelTrends ?? [];
  const knownSelectedModelIds = selectedModelIds.filter((id) => modelTrends.some((series) => series.id === id));
  const activeSelectedModelIds = knownSelectedModelIds.length
    ? knownSelectedModelIds
    : modelTrends.slice(0, 1).map((series) => series.id);
  const selectedModels = modelTrends.filter((series) => activeSelectedModelIds.includes(series.id));
  const model = selectedModels[0] ?? modelTrends[0];
  const latestResetTime = formatBeijing(data?.latestConfirmed?.occurredAt);
  const toggleModel = (id: string) => {
    setSelectedModelIds((current) => {
      const visible = current.filter((candidate) => modelTrends.some((series) => series.id === candidate));
      const next = visible.length ? visible : modelTrends.slice(0, 1).map((series) => series.id);
      if (next.includes(id)) return next.length > 1 ? next.filter((candidate) => candidate !== id) : next;
      return [...next, id];
    });
  };
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
            <span>Codex 重置雷达</span>
          </a>
          <button className="refresh" onClick={() => void refresh()} disabled={loading}>
            <span aria-hidden="true">↻</span>
            {loading ? "更新中" : "刷新"}
          </button>
        </nav>

        <section className="signal-panel" id="top" aria-label="重置信号摘要">
          <article className="latest-card">
            <p>最近一次重置</p>
            <strong className="latest-reset-time">
              <span>{latestResetTime.date}</span>
              {latestResetTime.time ? <span>{latestResetTime.time}</span> : null}
            </strong>
            <span className="latest-timezone">北京时间</span>
            {data?.latestConfirmed ? (
              <a href={data.latestConfirmed.sourceUrl} target="_blank" rel="noreferrer">查看原始来源 ↗</a>
            ) : null}
          </article>
          <article className={`probability-card ${tone}`}>
            <p>未来 48 小时</p>
            <strong>{probability === null || probability === undefined ? "—" : `${probability}%`}</strong>
            <span>
              <a href={RESET_RADAR_URL} target="_blank" rel="noreferrer">
                {data?.probabilitySource ?? "正在读取公开来源"} ↗
              </a>
            </span>
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
            <a
              className="timeline-latest-link"
              href={data?.history[0]?.sourceUrl ?? CODEX_RESETS_URL}
              target="_blank"
              rel="noreferrer"
            >
              最新记录 ↗
            </a>
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
            <span>{formatSourceUpdatedAt(data?.quotaUpdatedAt)} 更新</span>
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
                      <th scope="row">{row.tier}</th>
                      <td>{row.sevenDayQuota === null ? "—" : formatValue(row.sevenDayQuota, "USD / 7d")}</td>
                      <td><a href={CODEX_RADAR_URL} target="_blank" rel="noreferrer">{row.basis} ↗</a></td>
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
          <SourceCaption href={CODEX_RADAR_URL} label="Codex 雷达 codexradar.com" />
        </section>

        <section className="chart-section model-section" aria-labelledby="model-title">
          <div className="section-heading chart-heading">
            <div>
              <p className="eyebrow">MODEL CURVES</p>
              <h2 id="model-title">模型 IQ、价格与性价比</h2>
            </div>
            <span>{formatSourceUpdatedAt(data?.modelUpdatedAt)} 更新</span>
          </div>
          <p className="model-intro">每张卡片是一种公开测量配置；可同时选择多个模型进行对比。价格为单任务平均价格。</p>
          <div className="model-card-grid" aria-label="模型配置选择">
            {modelTrends.map((series) => (
              <ModelCard
                key={series.id}
                series={series}
                selected={activeSelectedModelIds.includes(series.id)}
                onSelect={() => toggleModel(series.id)}
              />
            ))}
          </div>
          <div className="model-curve-toolbar">
            <p>
              <span aria-hidden="true" style={{ background: selectedModels.length === 1 && model ? modelColor(model.id) : "#5f6f7a" }} />
              已选模型：<strong>{selectedModels.length ? `${selectedModels.length} 个` : "等待数据"}</strong>
            </p>
            <label className="model-metric-select">
              <span>切换曲线指标</span>
              <select value={metric} onChange={(event) => setMetric(event.target.value as ModelMetric)}>
                {(Object.keys(metricMeta) as ModelMetric[]).map((key) => (
                  <option key={key} value={key}>{metricMeta[key].label} 曲线</option>
                ))}
              </select>
            </label>
          </div>
          {modelTrends.length ? (
            <ModelComparisonChart
              series={modelTrends}
              metric={metric}
              selectedIds={activeSelectedModelIds}
              onToggle={toggleModel}
            />
          ) : <div className="empty-state">等待模型曲线数据。</div>}
          <p className="chart-note">性价比 = IQ ÷ 单任务平均价格，仅用于同一公开任务集内的相对比较。</p>
          <SourceCaption href={CODEX_RADAR_URL} label="Codex 雷达 codexradar.com" />
        </section>

        <footer>
          <p>48 小时概率来自 Codex Reset Radar 的公开信号评估，不是 OpenAI 的承诺；个人账户的滚动限额请以 Codex 设置页为准。</p>
          <div>
            {data?.sources.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.name}>
                <i className={source.status} />{source.name} ↗
              </a>
            ))}
          </div>
        </footer>
      </div>
    </main>
  );
}
