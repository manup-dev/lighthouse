import os
from pathlib import Path

import pytest

from lighthouse.analyzer import RepoAnalyzer
from lighthouse.models import TechFingerprint

FIXTURE = Path(__file__).parent / "fixtures" / "repos" / "demo_repo"
PROJECT_ROOT = Path(__file__).resolve().parent.parent


def test_analyze_returns_tech_fingerprint():
    fp = RepoAnalyzer().analyze(str(FIXTURE))
    assert isinstance(fp, TechFingerprint)


def test_analyze_extracts_languages_from_file_extensions():
    fp = RepoAnalyzer().analyze(str(FIXTURE))
    assert "python" in fp.languages
    assert "typescript" in fp.languages


def test_analyze_extracts_frameworks_from_package_json_and_pyproject():
    fp = RepoAnalyzer().analyze(str(FIXTURE))
    assert "react" in fp.frameworks
    assert "next" in fp.frameworks
    assert "express" in fp.frameworks
    assert "fastapi" in fp.frameworks


def test_analyze_detects_logistics_domain_from_readme():
    fp = RepoAnalyzer().analyze(str(FIXTURE))
    assert "logistics" in fp.domain_hints


def test_analyze_readme_summary_truncated_to_600_chars():
    fp = RepoAnalyzer().analyze(str(FIXTURE))
    assert len(fp.readme_summary) <= 600
    assert fp.readme_summary.startswith("# FreightFlow")


def test_analyze_returns_empty_commit_themes_when_not_a_git_repo():
    fp = RepoAnalyzer().analyze(str(FIXTURE))
    assert fp.recent_commit_themes == []


def test_analyze_extracts_commit_themes_from_real_git_repo():
    fp = RepoAnalyzer().analyze(str(PROJECT_ROOT))
    assert len(fp.recent_commit_themes) >= 1
    joined = " ".join(fp.recent_commit_themes).lower()
    assert "scaffold" in joined or "models" in joined


@pytest.mark.skipif(
    os.environ.get("LIGHTHOUSE_OFFLINE") == "1",
    reason="offline mode — skipping real GitHub URL clone",
)
def test_analyze_handles_github_url_by_cloning(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    fp = RepoAnalyzer().analyze("https://github.com/pallets/flask")
    assert isinstance(fp, TechFingerprint)
    assert "python" in fp.languages
