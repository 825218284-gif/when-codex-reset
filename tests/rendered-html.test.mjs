import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(html, /额度雷达/);
  assert.doesNotMatch(html, /codex-preview|Building your site|Starter Project/i);
});

test("GitHub Pages build contains the dashboard and a usable data snapshot", async () => {
  const [html, rawSnapshot] = await Promise.all([
    readFile(new URL("../pages-dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../pages-dist/data/briefing.json", import.meta.url), "utf8"),
  ]);
  const snapshot = JSON.parse(rawSnapshot);

  assert.match(html, /<title>Codex 额度重置雷达<\/title>/i);
  assert.match(html, /data-briefing-url="\/data\/briefing\.json"/);
  assert.match(html, /\/assets\/index-[^"']+\.js/);
  assert.ok(Array.isArray(snapshot.sources) && snapshot.sources.length === 3);
  assert.ok(Array.isArray(snapshot.history) && snapshot.history.length > 0);
  assert.ok(Array.isArray(snapshot.quotaSnapshot) && snapshot.quotaSnapshot.length > 0);
  assert.ok(Array.isArray(snapshot.modelTrends) && snapshot.modelTrends.length > 0);
});
