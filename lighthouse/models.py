from typing import Any, Literal

from pydantic import BaseModel


class TechFingerprint(BaseModel):
    languages: list[str]
    frameworks: list[str]
    domain_hints: list[str]
    recent_commit_themes: list[str]
    readme_summary: str


class Thesis(BaseModel):
    moat: str
    themes: list[str]
    icp: dict[str, Any]
    ideal_hire: dict[str, Any]


class CrustQueryPlan(BaseModel):
    endpoint: Literal["/person/search", "/company/search", "/web/search/live"]
    track: Literal["investor", "design_partner", "talent"]
    payload: dict[str, Any]
    rationale: str


class PersonCandidate(BaseModel):
    name: str
    title: str
    company: str
    linkedin: str | None = None
    recent_post: str | None = None
    recent_post_url: str | None = None
    recent_post_date: str | None = None
    geo_distance_km: float | None = None


class CompanyCandidate(BaseModel):
    name: str
    domain: str | None = None
    industry: str | None = None
    headcount: int | None = None
    last_round_type: str | None = None
    hq_country: str | None = None
    signal_post: str | None = None
    signal_post_url: str | None = None
    signal_post_date: str | None = None


class MatchedPerson(PersonCandidate):
    score: float
    sub_scores: dict[str, float]
    warm_intro_draft: str = ""


class StageEvent(BaseModel):
    stage: str
    status: Literal["start", "progress", "done", "error"]
    payload: dict[str, Any] | None = None


class LogEvent(BaseModel):
    """Free-form trace line for streaming pipeline activity to clients."""

    message: str
    level: Literal["info", "warn", "error"] = "info"
    stage: str | None = None


class ReQueryRequest(BaseModel):
    track: str
    reason: str
    widen_filters: dict[str, Any]


class MatchResult(BaseModel):
    repo_url: str
    thesis: Thesis
    query_plan: list[CrustQueryPlan]
    investors: list[MatchedPerson]
    design_partners: list[MatchedPerson]
    talent: list[MatchedPerson]
    stats: dict[str, Any]
