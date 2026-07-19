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

export interface TrendPoint {
  at: string;
  value: number | null;
}

export interface QuotaTrendSeries {
  id: string;
  label: string;
  unit: string;
  points: TrendPoint[];
}

export interface ModelTrendPoint {
  at: string;
  score: number | null;
  cost: number | null;
  value: number | null;
}

export interface ModelTrendSeries {
  id: string;
  label: string;
  points: ModelTrendPoint[];
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
  quotaTrends: QuotaTrendSeries[];
  modelTrends: ModelTrendSeries[];
}
