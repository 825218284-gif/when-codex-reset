"use client";

import { useEffect, useMemo, useState } from "react";
import type { BriefingData, BriefingItem, Priority, Topic } from "./lib/briefing";

const topicOptions: Array<{ id: Topic; label: string; hint: string }> = [
  { id: "all", label: "全部", hint: "完整简报" },
  { id: "reset", label: "重置", hint: "确认信号与窗口" },
  { id: "quota", label: "Plus 额度", hint: "公开容量观测" },
  { id: "card", label: "发卡", hint: "重置卡信号与账户检查" },
  { id: "model", label: "模型参数", hint: "型号、推理强度与成本" },
];

const priorityLabel: Record<Priority, string> = {
  critical: "立即关注",
  high: "优先查看",
  normal: "常规更新",
  low: "背景参考",
};

const priorityOrder: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function formatTimestamp(value?: string) {
  if (!value) return "刚刚整理";
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

function topicLabel(topic: Topic) {
  return topicOptions.find((option) => option.id === topic)?.label ?? topic;
}

function SourceMark({ source, status }: { source: string; status: "live" | "unavailable" }) {
  return (
    <span className={`source-mark ${status === "live" ? "is-live" : "is-offline"}`}>
      <span aria-hidden="true" />
      {source}
    </span>
  );
}

function MetricCard({
  eyebrow,
  value,
  note,
  tone = "neutral",
}: {
  eyebrow: string;
  value: string;
  note: string;
  tone?: "neutral" | "mint" | "amber";
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <p>{eyebrow}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [topic, setTopic] = useState<Topic>("all");
  const [actionOnly, setActionOnly] = useState(false);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [keyword, setKeyword] = useState("");

  async function refresh() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/briefing", { cache: "no-store" });
      const next = (await response.json()) as BriefingData;
      if (!response.ok) throw new Error("来源暂时没有响应");
      setData(next);
    } catch {
      setMessage("暂时无法获取两站公开摘要，请稍后重试或直接访问原站。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const items = useMemo(() => {
    if (!data) return [];
    const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
    return [...data.items]
      .filter((item) => topic === "all" || item.topic === topic)
      .filter((item) => !actionOnly || item.priority === "critical" || item.priority === "high")
      .filter((item) => sourceFilter === "all" || item.source === sourceFilter)
      .filter((item) => {
        if (!normalizedKeyword) return true;
        return [item.title, item.detail, item.action, item.source, item.confidence]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedKeyword);
      })
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }, [actionOnly, data, keyword, sourceFilter, topic]);

  const sourceNames = data?.sources.map((source) => source.name) ?? [];
  const plusQuota = data?.summary.quotaRows.find((row) => row.tier.toLocaleLowerCase().includes("plus"));
  const quotaText = plusQuota
    ? `$${plusQuota.amount?.toLocaleString("en-US")}`
    : "—";

  return (
    <main>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="shell">
        <nav className="topbar" aria-label="主导航">
          <a className="brand" href="#top" aria-label="Codex 更新筛选台首页">
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <b>Codex Plus 更新台</b>
              <small>signal, not noise</small>
            </span>
          </a>
          <div className="topbar-links">
            <a href="#briefing">今日简报</a>
            <a href="#models">模型选择</a>
            <a href="#sources">数据边界</a>
          </div>
          <button className="refresh-button" onClick={() => void refresh()} disabled={loading}>
            <span aria-hidden="true">↻</span>
            {loading ? "同步中" : "刷新公开摘要"}
          </button>
        </nav>

        <header className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">为实际使用 Codex 的人设计</p>
            <h1>
              只看会改变
              <em>你今天决策</em>
              的更新
            </h1>
            <p className="hero-description">
              为 Plus 用户把公开额度、重置与发卡线索、模型参数放在同一张工作台。每条结论都保留来源，让你能快速过滤，也能随时追溯。
            </p>
            <div className="hero-cues">
              <span>Plus 额度优先</span>
              <span>重置与发卡分开看</span>
              <span>模型参数可横向比较</span>
              <span>不接触你的账户</span>
            </div>
          </div>

          <aside className="focus-panel" aria-label="筛选控制">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">我的关注</p>
                <h2>把噪声留在外面</h2>
              </div>
              <span className="focus-dot" title="本地筛选" />
            </div>
            <label className="search-field">
              <span>搜索本次简报</span>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="例如：Pro、Sol、重置"
              />
            </label>
            <label className="toggle-row">
              <span>
                <b>只看需要行动</b>
                <small>优先显示重置和发卡事项</small>
              </span>
              <input
                type="checkbox"
                checked={actionOnly}
                onChange={(event) => setActionOnly(event.target.checked)}
              />
              <i aria-hidden="true" />
            </label>
            <div className="focus-caption">筛选只保存在当前浏览器，不会上传你的偏好或账户信息。</div>
          </aside>
        </header>

        <section className="status-strip" aria-label="当前摘要">
          <MetricCard
            eyebrow="重置状态"
            value={data?.summary.resetState ?? (loading ? "读取中" : "暂不可用")}
            note={data?.summary.resetDetail ?? "正在读取公开来源"}
            tone={data?.summary.resetState.includes("确认") ? "amber" : "neutral"}
          />
          <MetricCard
            eyebrow="48 小时关注度"
            value={data?.summary.resetChance48h === null || data?.summary.resetChance48h === undefined ? "—" : `${data.summary.resetChance48h}%`}
            note="这是公开信号归纳，不是官方承诺"
            tone="amber"
          />
          <MetricCard
            eyebrow="当前综合最高分"
            value={data?.summary.bestModel ? `${data.summary.bestModel.score}` : "—"}
            note={data?.summary.bestModel?.name ?? "等待公开测量"}
            tone="mint"
          />
          <MetricCard
            eyebrow="Plus 7d 公开观测"
            value={quotaText}
            note="公开容量测量，非你的个人余额"
          />
          <MetricCard
            eyebrow="发卡 / 重置卡"
            value={data?.summary.cardState ?? (loading ? "读取中" : "暂不可用")}
            note={data?.summary.cardDetail ?? "你的卡余额和到期只在设置中可见"}
            tone="neutral"
          />
        </section>

        <section className="workbench" id="briefing">
          <div className="section-heading">
            <div>
              <p className="eyebrow">可筛选简报</p>
              <h2>Plus 用户现在该看什么？</h2>
            </div>
            <span className="freshness">
              {loading ? "正在同步来源" : `北京时间 ${formatTimestamp(data?.generatedAt)} 整理`}
            </span>
          </div>

          <div className="filter-bar" aria-label="简报筛选">
            <div className="filter-group" aria-label="按主题筛选">
              {topicOptions.map((option) => (
                <button
                  className={topic === option.id ? "filter-chip is-active" : "filter-chip"}
                  key={option.id}
                  onClick={() => setTopic(option.id)}
                  aria-pressed={topic === option.id}
                  title={option.hint}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="source-select-wrap">
              <label htmlFor="source-filter">来源</label>
              <select
                id="source-filter"
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
              >
                <option value="all">全部来源</option>
                {sourceNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {message ? <div className="message-card">{message}</div> : null}

          <div className="briefing-layout">
            <div className="feed">
              <div className="feed-meta">
                <span>已找到 {items.length} 条与你筛选条件匹配的信息</span>
                {actionOnly ? <b>行动视图已开启</b> : <b>完整视图</b>}
              </div>
              {loading && !data ? (
                <div className="loading-list" aria-label="正在加载简报">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              {!loading && !items.length ? (
                <div className="empty-state">
                  <span aria-hidden="true">○</span>
                  <h3>没有匹配项</h3>
                  <p>可以关闭“只看需要行动”，或换一个主题、来源和关键词。</p>
                  <button
                    onClick={() => {
                      setTopic("all");
                      setActionOnly(false);
                      setSourceFilter("all");
                      setKeyword("");
                    }}
                  >
                    清除筛选
                  </button>
                </div>
              ) : null}
              {items.map((item) => (
                <BriefingCard item={item} key={item.id} />
              ))}
            </div>

            <aside className="side-notes">
              <div className="side-note main-note">
                <p className="eyebrow">读法</p>
                <h3>先看“立即关注”，再决定是否展开细节。</h3>
                <p>
                  重置预测、模型分数和公开额度都适合辅助判断；涉及你的工作安排或账户状态时，请回到原始来源与 Codex 设置页确认。
                </p>
              </div>
              <div className="side-note source-summary">
                <p className="eyebrow">来源健康度</p>
                {data?.sources.map((source) => (
                  <a href={source.url} target="_blank" rel="noreferrer" key={source.name}>
                    <SourceMark source={source.name} status={source.status} />
                    <span>打开原站 ↗</span>
                  </a>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className="models-section" id="models">
          <div className="section-heading">
            <div>
              <p className="eyebrow">模型参数</p>
              <h2>把型号与推理强度放到同一把尺子上</h2>
            </div>
            <p className="section-explainer">
              这里的“参数”指可选型号、推理强度、公开效果、成本和耗时，不代表厂商未公开的模型参数量；它适合作为候选排序而非最终结论。
            </p>
          </div>
          <div className="model-callouts">
            <div>
              <span>效果优先参数组合</span>
              <b>{data?.summary.bestModel?.name ?? "等待数据"}</b>
              <small>综合分 {data?.summary.bestModel?.score ?? "—"}</small>
            </div>
            <div>
              <span>性价比参数组合</span>
              <b>{data?.summary.bestValue?.name ?? "等待数据"}</b>
              <small>
                {data?.summary.bestValue?.cost === null || data?.summary.bestValue?.cost === undefined
                  ? "等待成本数据"
                  : `约 $${data.summary.bestValue.cost}/任务`}
              </small>
            </div>
          </div>
          <div className="model-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>配置</th>
                  <th>推理强度</th>
                  <th>综合分</th>
                  <th>平均成本</th>
                  <th>平均耗时</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {data?.models.map((model) => (
                  <tr key={model.id}>
                    <td>{model.name}</td>
                    <td>{model.effort}</td>
                    <td className="score-cell">{model.score}</td>
                    <td>{model.cost === null ? "—" : `$${model.cost}`}</td>
                    <td>{model.time}</td>
                    <td>
                      <span className={`table-status ${model.status}`}>
                        {model.status === "green" ? "良好" : model.status === "yellow" ? "注意波动" : model.status === "red" ? "低于基准" : "待判定"}
                      </span>
                    </td>
                  </tr>
                ))}
                {!loading && !data?.models.length ? (
                  <tr>
                    <td colSpan={6} className="table-empty">暂时没有可显示的公开模型数据。</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="sources-section" id="sources">
          <div>
            <p className="eyebrow">数据来源与边界</p>
            <h2>保留判断边界，才不会把“雷达”当“结论”。</h2>
          </div>
          <div className="source-rules">
            <p>
              本站只读取 <a href={CODEX_RADAR_SITE} target="_blank" rel="noreferrer">Codex 雷达</a>公开提供的当前摘要，以及 <a href={RESET_RADAR_SITE} target="_blank" rel="noreferrer">Codex Reset Radar</a> 页面可追溯的重置信号；不读取你的 Codex 账户，也不保存账户凭据。
            </p>
            <p className="attribution">数据来自 Codex 雷达 codexradar.com</p>
            <p>
              模型分数、公开额度观测和重置关注度均非官方保证。任何涉及限额、重置、故障或订阅权益的决定，都应回到原始来源、OpenAI 状态页和你自己的 Codex 设置页确认。
            </p>
          </div>
        </section>

        <footer>
          <span>Codex Plus 更新台</span>
          <span>Plus 额度、重置、发卡与模型参数 · 仅供信息筛选与追溯</span>
        </footer>
      </section>
    </main>
  );
}

function BriefingCard({ item }: { item: BriefingItem }) {
  return (
    <article className={`briefing-card priority-${item.priority}`}>
      <div className="card-rail" aria-hidden="true" />
      <div className="card-content">
        <div className="card-topline">
          <div>
            <span className={`priority-badge priority-${item.priority}`}>{priorityLabel[item.priority]}</span>
            <span className="topic-badge">{topicLabel(item.topic)}</span>
          </div>
          <span className="card-time">{formatTimestamp(item.updatedAt)}</span>
        </div>
        <h3>{item.title}</h3>
        <p>{item.detail}</p>
        <div className="card-bottomline">
          <span className="confidence">{item.confidence}</span>
          <span className="action-label">建议：{item.action}</span>
          <a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${item.source} 原始来源`}>
            {item.source} ↗
          </a>
        </div>
      </div>
    </article>
  );
}

const CODEX_RADAR_SITE = "https://codexradar.com/";
const RESET_RADAR_SITE = "https://codexresetradar.com/";
