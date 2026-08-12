import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hasCompleteModelSet, hasCompleteQuotaData, mergeBriefingSnapshots, type ResetBriefing } from "../app/lib/briefing.ts";
import { GET } from "../app/api/briefing/route.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(
  projectRoot,
  process.env.BRIEFING_OUTPUT ?? "public/data/briefing.json",
);

function isBriefing(value: unknown): value is ResetBriefing {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResetBriefing>;
  return typeof candidate.generatedAt === "string"
    && Array.isArray(candidate.sources)
    && Array.isArray(candidate.history)
    && Array.isArray(candidate.quotaSnapshot)
    && Array.isArray(candidate.quotaTrends)
    && Array.isArray(candidate.modelTrends);
}

async function readLocalSnapshot() {
  try {
    const parsed: unknown = JSON.parse(await readFile(outputPath, "utf8"));
    return isBriefing(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function derivedPagesSnapshotUrl() {
  const explicit = safeHttpsUrl(process.env.BRIEFING_PREVIOUS_URL);
  if (process.env.BRIEFING_PREVIOUS_URL && !explicit) {
    console.warn("Ignored BRIEFING_PREVIOUS_URL because it is not a valid HTTPS URL.");
  }
  if (explicit) return explicit;
  if (process.env.GITHUB_ACTIONS !== "true") return null;

  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return null;
  const [owner, repo, ...rest] = repository.split("/");
  if (!owner || !repo || rest.length) return null;
  const path = repo.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? ""
    : `/${encodeURIComponent(repo)}`;
  return `https://${owner}.github.io${path}/data/briefing.json`;
}

async function readRemoteSnapshot(url: string | null) {
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed: unknown = await response.json();
    if (!isBriefing(parsed)) throw new Error("response is not a briefing snapshot");
    console.log(`Using the last published snapshot from ${url}`);
    return parsed;
  } catch (error) {
    console.warn(
      `Could not read the last published snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

const remoteSnapshotUrl = derivedPagesSnapshotUrl();
const remotePrevious = await readRemoteSnapshot(remoteSnapshotUrl);
// In CI, an unavailable live snapshot must not silently fall back to an older
// repository copy. A complete live refresh can still publish without it; a
// partial refresh will fail the completeness checks below and leave production
// untouched.
const previous = remoteSnapshotUrl ? remotePrevious : await readLocalSnapshot();
const response = await GET();
const next = (await response.json()) as ResetBriefing;

if (!response.ok) {
  throw new Error("All critical sources failed; keeping the currently published snapshot unchanged");
}

const briefing = mergeBriefingSnapshots(next, previous);
if (
  !briefing.latestConfirmed
  || briefing.history.length === 0
  || !hasCompleteQuotaData(briefing.quotaSnapshot, briefing.quotaTrends)
  || !hasCompleteModelSet(briefing.modelTrends)
) {
  throw new Error("Merged snapshot failed completeness checks; refusing to overwrite the published snapshot");
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(briefing, null, 2)}\n`, "utf8");

console.log(
  `Published ${briefing.history.length} resets, ${briefing.quotaSnapshot.length} quota rows, and ${briefing.modelTrends.length} model series.`,
);
for (const source of briefing.sources) {
  console.log(
    `${source.key ?? source.name}: ${source.status}; last success ${source.lastSuccessAt ?? "unknown"}; stale=${Boolean(source.stale)}; fallback=${Boolean(source.fallback)}`,
  );
}
