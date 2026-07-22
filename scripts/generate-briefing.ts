import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResetBriefing } from "../app/lib/briefing.ts";
import { GET } from "../app/api/briefing/route.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  projectRoot,
  process.env.BRIEFING_OUTPUT ?? "public/data/briefing.json",
);

async function readPreviousSnapshot() {
  try {
    return JSON.parse(await readFile(outputPath, "utf8")) as ResetBriefing;
  } catch {
    return null;
  }
}

function sourceIsLive(briefing: ResetBriefing, name: string) {
  return briefing.sources.some((source) => source.name === name && source.status === "live");
}

function preserveUnavailableSources(next: ResetBriefing, previous: ResetBriefing | null) {
  if (!previous) return next;

  const resetsLive = sourceIsLive(next, "Codex Resets") && next.history.length > 0;
  const probabilityLive = sourceIsLive(next, "Codex Reset Radar");
  const radarLive = sourceIsLive(next, "Codex 雷达")
    && next.quotaSnapshot.length > 0
    && next.modelTrends.length > 0;

  return {
    ...next,
    verdict: resetsLive ? next.verdict : previous.verdict,
    verdictDetail: resetsLive ? next.verdictDetail : previous.verdictDetail,
    latestConfirmed: resetsLive ? next.latestConfirmed : previous.latestConfirmed,
    history: resetsLive ? next.history : previous.history,
    probability48h: probabilityLive ? next.probability48h : previous.probability48h,
    probabilitySource: probabilityLive ? next.probabilitySource : previous.probabilitySource,
    quotaUpdatedAt: radarLive ? next.quotaUpdatedAt : previous.quotaUpdatedAt,
    quotaSnapshot: radarLive ? next.quotaSnapshot : previous.quotaSnapshot,
    quotaTrends: radarLive ? next.quotaTrends : previous.quotaTrends,
    modelUpdatedAt: radarLive ? next.modelUpdatedAt : previous.modelUpdatedAt,
    modelTrends: radarLive ? next.modelTrends : previous.modelTrends,
  } satisfies ResetBriefing;
}

const previous = await readPreviousSnapshot();
const response = await GET();
const next = (await response.json()) as ResetBriefing;

if (!response.ok && !previous) {
  throw new Error("No source returned data and no previous snapshot is available");
}

const briefing = preserveUnavailableSources(next, previous);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(briefing, null, 2)}\n`, "utf8");

console.log(
  `Updated ${briefing.history.length} resets, ${briefing.quotaSnapshot.length} quota rows, and ${briefing.modelTrends.length} model series.`,
);
