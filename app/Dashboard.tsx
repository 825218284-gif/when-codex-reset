"use client";

import { useEffect, useState } from "react";
import type { ResetBriefing } from "./lib/briefing";

function formatBeijing(value: string | null | undefined) {
  if (!value) return "时间待来源补全";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date).replace(/\//g, ".");
}

function formatCheckedAt(value?: string) {
  if (!value) return "正在读取";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚整理";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function probabilityTone(value: number | null | undefined) {
  if (value === null || value === undefined) return "unknown";
  if (value >= 60) return "high";
  if (value >= 30) return "watch";
  return "calm";
}

export default function Dashboard() {
  const [data, setData] = useState<ResetBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    void refresh();
  }, []);

  const probability = data?.probability48h;
  const tone = probabilityTone(probability);

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

        <header className="hero" id="top">
          <p className="eyebrow">PUBLIC RESET SIGNAL MONITOR</p>
          <h1>只关注<br /><em>硬重置。</em></h1>
          <p className="hero-copy">未来 48 小时的公开信号评估，和每一次已确认硬重置的时间轴。</p>
        </header>

        <section className="signal-panel" aria-label="重置信号摘要">
          <article className={`probability-card ${tone}`}>
            <p>未来 48 小时</p>
            <strong>{probability === null || probability === undefined ? "—" : `${probability}%`}</strong>
            <span>{data?.probabilitySource ?? "正在读取公开来源"}</span>
          </article>
          <article className="verdict-card">
            <p>当前核验结论</p>
            <h2>{data?.verdict ?? (loading ? "正在核验" : "暂不可用")}</h2>
            <span>{data?.verdictDetail ?? "仅显示有可追溯来源的事件"}</span>
          </article>
          <article className="latest-card">
            <p>最近一次确认</p>
            <h2>{data?.latestConfirmed?.title ?? "等待来源响应"}</h2>
            <span>{formatBeijing(data?.latestConfirmed?.occurredAt)} 北京时间</span>
            {data?.latestConfirmed ? (
              <a href={data.latestConfirmed.sourceUrl} target="_blank" rel="noreferrer">查看原始来源 ↗</a>
            ) : null}
          </article>
        </section>

        {error ? <p className="error-message">{error}</p> : null}

        <section className="timeline-section" aria-labelledby="timeline-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CONFIRMED HISTORY</p>
              <h2 id="timeline-title">硬重置时间轴</h2>
            </div>
            <span>北京时间 {formatCheckedAt(data?.generatedAt)} 更新</span>
          </div>

          {loading && !data ? <div className="timeline-loading"><i /><i /><i /></div> : null}
          {!loading && !data?.history.length ? (
            <div className="empty-state">暂未读取到可展示的硬重置历史。</div>
          ) : null}
          <ol className="timeline">
            {data?.history.map((event, index) => (
              <li key={event.id}>
                <div className="timeline-node" aria-hidden="true"><span /></div>
                <time>{event.date}</time>
                <div className="timeline-event">
                  <span>HARD RESET · 已确认</span>
                  <h3>{event.title}</h3>
                  <a href={event.sourceUrl} target="_blank" rel="noreferrer">原始公告 ↗</a>
                </div>
                <b>{String(index + 1).padStart(2, "0")}</b>
              </li>
            ))}
          </ol>
        </section>

        <footer>
          <p>48 小时概率是公开信号评估，不是 OpenAI 的承诺；个人账户的滚动限额请以 Codex 设置页为准。</p>
          <div>
            {data?.sources.map((source) => (
              <a href={source.url} target="_blank" rel="noreferrer" key={source.name}>
                <i className={source.status} />{source.name} ↗
              </a>
            ))}
          </div>
          <small>数据来自 Codex 雷达 codexradar.com</small>
        </footer>
      </div>
    </main>
  );
}
