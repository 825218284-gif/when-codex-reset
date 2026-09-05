import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function pagesBase() {
  if (process.env.GITHUB_ACTIONS !== "true") return "/";
  const [owner = "", repository = ""] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  if (!repository) return "/";
  return repository.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? "/"
    : `/${repository}/`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the public dashboard shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Codex 额度重置雷达<\/title>/i);
  assert.match(html, /Codex 重置雷达/);
  assert.match(html, /最近一次重置/);
  assert.doesNotMatch(html, /未来 48 小时重置可能性/);
  assert.match(html, /额度重置时间轴/);
  assert.doesNotMatch(html, /额度雷达|公开 7d 额度/);
  assert.doesNotMatch(html, /codex-preview|Building your site|Starter Project/i);
});

test("GitHub Pages build contains the dashboard and a usable data snapshot", async () => {
  const [html, rawSnapshot, robots, sitemap, shareImage] = await Promise.all([
    readFile(new URL("../pages-dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../pages-dist/data/briefing.json", import.meta.url), "utf8"),
    readFile(new URL("../pages-dist/robots.txt", import.meta.url), "utf8"),
    readFile(new URL("../pages-dist/sitemap.xml", import.meta.url), "utf8"),
    readFile(new URL("../pages-dist/og-midnight-fantasy.jpg", import.meta.url)),
  ]);
  const snapshot = JSON.parse(rawSnapshot);
  const base = pagesBase();

  assert.match(html, /<title>Codex 额度重置雷达<\/title>/i);
  assert.match(
    html,
    new RegExp(`data-briefing-url="${escapeRegExp(base)}data/briefing\\.json"`),
  );
  assert.match(html, new RegExp(`${escapeRegExp(base)}assets/index-[^"']+\\.js`));
  assert.match(html, /rel="canonical" href="https:\/\/825218284-gif\.github\.io\/when-codex-reset\/"/);
  assert.match(html, /property="og:image"\s+content="https:\/\/825218284-gif\.github\.io\/when-codex-reset\/og-midnight-fantasy\.jpg"/);
  assert.match(robots, /Sitemap: https:\/\/825218284-gif\.github\.io\/when-codex-reset\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/825218284-gif\.github\.io\/when-codex-reset\/<\/loc>/);
  assert.ok(shareImage.byteLength > 100_000 && shareImage.byteLength < 1_000_000);

  assert.ok(Number.isFinite(Date.parse(snapshot.generatedAt)), "snapshot generatedAt must be valid");
  assert.ok(Array.isArray(snapshot.sources) && snapshot.sources.length >= 2);
  assert.ok(snapshot.sources.every((source) => /^https:\/\//.test(source.url)));
  assert.equal(snapshot.sources.find((source) => source.key === "quota")?.url, "https://codexradar.com/current.json");
  assert.equal(snapshot.sources.find((source) => source.key === "model")?.url, "https://codexradar.com/data/intelligence-efficiency.json");
  assert.ok(snapshot.sources.every((source) => typeof source.stale === "boolean"));
  assert.ok(Array.isArray(snapshot.history) && snapshot.history.length === 4);
  assert.ok(Array.isArray(snapshot.quotaSnapshot) && snapshot.quotaSnapshot.length > 0);
  assert.ok(Array.isArray(snapshot.quotaTrends) && snapshot.quotaTrends.length > 0);
  assert.equal(snapshot.modelTrends.length, 20);
  assert.deepEqual(
    snapshot.modelTrends.map((series) => series.id),
    [
      "gpt_6_astra_ultra", "gpt_6_astra_max", "gpt_6_astra_xhigh", "gpt_6_astra_high", "gpt_6_astra_medium", "gpt_6_astra_low",
      "gpt_56_sol_ultra", "gpt_56_sol_max", "gpt_56_sol_xhigh", "gpt_56_sol_high", "gpt_56_sol_medium", "gpt_56_sol_low",
      "gpt_56_luna_max", "gpt_56_luna_xhigh", "gpt_56_luna_high", "gpt_56_luna_medium", "gpt_56_luna_low",
      "glm_5_3_flash_max", "glm_5_3_flash_high", "glm_5_3_flash_low",
    ],
  );
});
