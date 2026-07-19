export type Topic = "all" | "reset" | "quota" | "card" | "model";
export type Priority = "critical" | "high" | "normal" | "low";

export type SourceStatus = "live" | "unavailable";

export interface SourceInfo {
  name: string;
  url: string;
  attribution?: string;
  status: SourceStatus;
}

export interface BriefingItem {
  id: string;
  topic: Exclude<Topic, "all">;
  priority: Priority;
  source: string;
  sourceUrl: string;
  confidence: string;
  title: string;
  detail: string;
  action: string;
  updatedAt?: string;
}

export interface ModelRow {
  id: string;
  name: string;
  effort: string;
  score: number;
  cost: number | null;
  time: string;
  status: "green" | "yellow" | "red" | "neutral";
}

export interface BriefingData {
  generatedAt: string;
  sources: SourceInfo[];
  summary: {
    resetState: string;
    resetDetail: string;
    resetChance48h: number | null;
    cardState: string;
    cardDetail: string;
    bestModel: ModelRow | null;
    bestValue: ModelRow | null;
    quotaRows: Array<{ tier: string; amount: number | null; window: string }>;
  };
  items: BriefingItem[];
  models: ModelRow[];
}
