import assert from "node:assert/strict";
import test from "node:test";
import { expectedModelIds, hasCompleteModelSet, hasCompleteQuotaData, mergeBriefingSnapshots, type BriefingSourceKey, type ModelTrendSeries, type ResetBriefing, type SourceStatus } from "../app/lib/briefing.ts";
import { GET, parseCodexResets } from "../app/api/briefing/route.ts";

function models(at: string, count: number = expectedModelIds.length): ModelTrendSeries[] {
  return expectedModelIds.slice(0, count).map((id) => ({
    id,
    label: id,
    points: [{ at, score: 90, cost: 3, value: 30, duration: "10分钟" }],
  }));
}

function source(key: BriefingSourceKey, status: SourceStatus, at: string) {
  return {
    key,
    name: key,
    url: key === "reset" ? "https://codex-resets.com/" : "https://codexradar.com/",
    status,
    lastSuccessAt: status === "live" ? at : null,
    dataUpdatedAt: at,
    fallback: false,
    stale: status !== "live",
  };
}

function briefing(at: string): ResetBriefing {
  return {
    generatedAt: at,
    sources: [source("reset", "live", at), source("quota", "live", at), source("model", "live", at)],
    verdict: `verdict ${at}`,
    verdictDetail: `detail ${at}`,
    latestConfirmed: {
      title: `reset ${at}`,
      occurredAt: at,
      sourceUrl: "https://x.com/example/status/1",
    },
    history: [{ id: "1", date: at, title: `reset ${at}`, sourceUrl: "https://x.com/example/status/1" }],
    quotaUpdatedAt: at,
    quotaSnapshot: [
      { tier: "20x Pro", sevenDayQuota: 2000, basis: "分布式雷达" },
      { tier: "5x Pro", sevenDayQuota: 500, basis: "推算" },
      { tier: "Plus", sevenDayQuota: 100, basis: "推算" },
    ],
    quotaTrends: [
      { id: "pro20-7d", label: "20x Pro", unit: "USD / 7d", points: [{ at, value: 2000 }] },
      { id: "pro5-5h", label: "5x Pro", unit: "USD / 5h", points: [{ at, value: 500 }] },
      { id: "plus-5h", label: "Plus", unit: "USD / 5h", points: [{ at, value: 100 }] },
    ],
    modelUpdatedAt: at,
    modelTrends: models(at),
  };
}

test("recognizes only the exact complete 19-model intelligence set", () => {
  const complete = models("2026-08-12T00:00:00Z");
  assert.equal(expectedModelIds.length, 19);
  assert.equal(hasCompleteModelSet(complete), true);
  assert.equal(hasCompleteModelSet(complete.slice(0, 12)), false);
  assert.equal(hasCompleteModelSet([...complete, complete[0]]), false);
  assert.equal(hasCompleteModelSet(complete.map((series, index) => index === 0 ? { ...series, points: [] } : series)), false);
});

test("quota completeness requires all three tiers, numeric values, and three usable trends", () => {
  const complete = briefing("2026-08-12T00:00:00Z");
  assert.equal(hasCompleteQuotaData(complete.quotaSnapshot, complete.quotaTrends), true);
  assert.equal(hasCompleteQuotaData(complete.quotaSnapshot.slice(0, 2), complete.quotaTrends), false);
  assert.equal(hasCompleteQuotaData(
    complete.quotaSnapshot.map((row) => row.tier === "Plus" ? { ...row, sevenDayQuota: null } : row),
    complete.quotaTrends,
  ), false);
  assert.equal(hasCompleteQuotaData(complete.quotaSnapshot, complete.quotaTrends.slice(0, 2)), false);
});

test("all failed sources retain the published snapshot and its generatedAt", () => {
  const previous = briefing("2026-08-12T00:00:00Z");
  const next = briefing("2026-08-12T01:00:00Z");
  next.sources = [
    source("reset", "unavailable", next.generatedAt),
    source("quota", "unavailable", next.generatedAt),
    source("model", "unavailable", next.generatedAt),
  ];
  next.history = [];
  next.latestConfirmed = null;
  next.quotaSnapshot = [];
  next.quotaTrends = [];
  next.modelTrends = [];

  const merged = mergeBriefingSnapshots(next, previous);
  assert.equal(merged.generatedAt, previous.generatedAt);
  assert.deepEqual(merged.history, previous.history);
  assert.deepEqual(merged.quotaSnapshot, previous.quotaSnapshot);
  assert.deepEqual(merged.modelTrends, previous.modelTrends);
  assert.deepEqual(merged.sources.map((item) => item.status), ["fallback", "fallback", "fallback"]);
  assert.ok(merged.sources.every((item) => item.fallback && item.stale));
});

test("an incomplete intelligence response cannot replace the complete model set", () => {
  const previous = briefing("2026-08-12T00:00:00Z");
  const next = briefing("2026-08-12T01:00:00Z");
  next.modelTrends = models(next.generatedAt, 12);

  const merged = mergeBriefingSnapshots(next, previous);
  assert.deepEqual(merged.modelTrends, previous.modelTrends);
  assert.equal(merged.sources.find((item) => item.key === "model")?.status, "fallback");
  assert.equal(merged.sources.find((item) => item.key === "reset")?.status, "live");
});

test("an incomplete quota response cannot replace the complete quota snapshot", () => {
  const previous = briefing("2026-08-12T00:00:00Z");
  const next = briefing("2026-08-12T01:00:00Z");
  next.quotaSnapshot = next.quotaSnapshot.slice(0, 2);

  const merged = mergeBriefingSnapshots(next, previous);
  assert.deepEqual(merged.quotaSnapshot, previous.quotaSnapshot);
  assert.deepEqual(merged.quotaTrends, previous.quotaTrends);
  assert.equal(merged.sources.find((item) => item.key === "quota")?.status, "fallback");
});

test("older source timestamps are rejected independently", () => {
  const previous = briefing("2026-08-12T02:00:00Z");
  const next = briefing("2026-08-12T03:00:00Z");
  next.latestConfirmed = { ...next.latestConfirmed!, occurredAt: "2026-08-11T23:00:00Z" };
  next.history = [{ ...next.history[0], date: "2026-08-11T23:00:00Z" }];
  next.quotaUpdatedAt = "2026-08-11T23:00:00Z";
  next.modelUpdatedAt = "2026-08-12T04:00:00Z";

  const merged = mergeBriefingSnapshots(next, previous);
  assert.deepEqual(merged.history, previous.history);
  assert.equal(merged.quotaUpdatedAt, previous.quotaUpdatedAt);
  assert.equal(merged.modelUpdatedAt, next.modelUpdatedAt);
  assert.deepEqual(merged.sources.map((item) => item.status), ["fallback", "fallback", "live"]);
});

test("reset parsing sorts events and keeps each title paired with its own time", () => {
  const parsed = parseCodexResets(`
    <a class="cg-cell" data-level="1" data-reset-type="regular" data-date="2026-08-10" data-count="1"></a>
    <a class="cg-cell" data-level="1" data-reset-type="banked" data-date="2026-08-12" data-count="1"></a>
    <li class="log-item">
      <time data-datetime="2026-08-10T01:00:00.000Z"></time>
      <a class="log-item-link" href="https://x.com/example/status/older"></a>
      <p class="log-item-text">older title</p>
    </li>
    <li class="log-item">
      <time data-datetime="2026-08-12T02:30:00.000Z"></time>
      <a class="log-item-link" href="http://evil.example/reset"></a>
      <p class="log-item-text">newer title</p>
    </li>
  `);

  assert.equal(parsed.history[0].title, "newer title");
  assert.equal(parsed.history[0].date, "2026.08.12 10:30");
  assert.equal(parsed.history[0].kind, "banked");
  assert.equal(parsed.history[1].kind, "regular");
  assert.equal(parsed.latestConfirmed?.title, "newer title");
  assert.equal(parsed.latestConfirmed?.occurredAt, "2026-08-12T02:30:00.000Z");
  assert.equal(parsed.latestConfirmed?.sourceUrl, "https://codex-resets.com/");
});

test("the API never substitutes the smaller legacy model collection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://codex-resets.com/") {
      return new Response(`
        <li class="log-item">
          <time data-datetime="2026-08-12T02:30:00.000Z"></time>
          <a class="log-item-link" href="https://x.com/example/status/1"></a>
          <p class="log-item-text">reset title</p>
        </li>
      `, { status: 200 });
    }
    if (url.endsWith("current.json")) {
      return Response.json({
        model_iq: {
          quota_radar: {
            updated_at: "2026-08-12T02:00:00Z",
            rows: [{ tier: "Plus", seven_d: 100, basis: "estimated" }],
            trend: [{ date: "2026-08-12", seven_d_20x: 100, five_h_5x: 50, five_h_plus: 25 }],
          },
          comparisons: { legacy: { latest: { score: 99 } } },
        },
      });
    }
    return Response.json({
      source_updated_at: "2026-08-12T02:00:00Z",
      points: expectedModelIds.slice(0, 12).map((id) => {
        const [, , family, effort] = id.split("_");
        return { model: `gpt-5.6-${family}`, effort, iq: 90, average_price_usd: 2, average_minutes: 10 };
      }),
      history: [],
    });
  };

  try {
    const response = await GET();
    const payload = await response.json() as ResetBriefing;
    assert.equal(response.status, 200);
    assert.deepEqual(payload.modelTrends, []);
    assert.equal(payload.sources.find((item) => item.key === "model")?.status, "unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("all failed critical sources return 502 without a fresh generatedAt", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline");
  };

  try {
    const response = await GET();
    const payload = await response.json() as ResetBriefing;
    assert.equal(response.status, 502);
    assert.equal(payload.generatedAt, "");
    assert.ok(payload.sources.every((item) => item.status === "unavailable"));
    assert.deepEqual(payload.history, []);
    assert.deepEqual(payload.quotaSnapshot, []);
    assert.deepEqual(payload.modelTrends, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("freshness uses fetch time for reset and upstream data time for quota and model", () => {
  const now = Date.now();
  const iso = (hoursAgo: number) => new Date(now - hoursAgo * 60 * 60 * 1000).toISOString();
  const previous = briefing(iso(2));
  const next = briefing(iso(0));
  next.latestConfirmed = { ...next.latestConfirmed!, occurredAt: iso(1) };
  next.history = [{ ...next.history[0], date: iso(1) }];
  next.quotaUpdatedAt = iso(25);
  next.modelUpdatedAt = iso(7);
  next.sources = [
    { ...source("reset", "live", iso(0)), dataUpdatedAt: iso(48), stale: false },
    { ...source("quota", "live", iso(0)), dataUpdatedAt: iso(25), stale: false },
    { ...source("model", "live", iso(0)), dataUpdatedAt: iso(7), stale: false },
  ];
  // Keep previous timestamps behind the deliberately old-but-newer next feeds,
  // so all three sources are accepted and only freshness policy is exercised.
  previous.quotaUpdatedAt = iso(26);
  previous.modelUpdatedAt = iso(8);

  const merged = mergeBriefingSnapshots(next, previous);
  assert.equal(merged.sources.find((item) => item.key === "reset")?.stale, false);
  assert.equal(merged.sources.find((item) => item.key === "quota")?.stale, true);
  assert.equal(merged.sources.find((item) => item.key === "model")?.stale, true);
});
