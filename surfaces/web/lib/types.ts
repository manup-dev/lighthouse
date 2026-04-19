export type Track = "investor" | "design_partner" | "talent";

export interface CrustQueryPlan {
  endpoint: string;
  track: Track;
  // Crustdata payloads are opaque / vendor-specific — keep as `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  rationale: string;
}

export interface Thesis {
  moat: string;
  themes: string[];
  // Free-form structured data from the analyzer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icp: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ideal_hire: Record<string, any>;
}

export interface MatchedPerson {
  name: string;
  title: string;
  company: string;
  linkedin: string | null;
  recent_post: string | null;
  recent_post_url: string | null;
  recent_post_date: string | null;
  geo_distance_km: number | null;
  score: number;
  sub_scores: Record<string, number>;
  warm_intro_draft: string;
}

export interface MatchResult {
  repo_url: string;
  thesis: Thesis;
  query_plan: CrustQueryPlan[];
  investors: MatchedPerson[];
  design_partners: MatchedPerson[];
  talent: MatchedPerson[];
  // Stats are free-form, plus Crustdata sometimes adds extra keys.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stats: Record<string, any>;
}

export type PipelineStage =
  | "analyzer"
  | "thesis"
  | "query_plan"
  | "crust_fanout"
  | "ranker"
  | "outreach"
  | "pipeline";

export interface StageEvent {
  stage: PipelineStage;
  status: "start" | "done";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Record<string, any>;
}

export interface LogEvent {
  message: string;
  level: "info" | "warn" | "error";
  stage: PipelineStage | null;
}
