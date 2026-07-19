export type SourceStatus = "live" | "unavailable";

export interface ResetSource {
  name: string;
  url: string;
  status: SourceStatus;
}

export interface HardResetEvent {
  id: string;
  date: string;
  title: string;
  sourceUrl: string;
}

export interface ResetBriefing {
  generatedAt: string;
  sources: ResetSource[];
  verdict: string;
  verdictDetail: string;
  probability48h: number | null;
  probabilitySource: string;
  latestConfirmed: {
    title: string;
    occurredAt: string | null;
    sourceUrl: string;
  } | null;
  history: HardResetEvent[];
}
