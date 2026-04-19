from __future__ import annotations

import json
import re
import subprocess
import tempfile
import tomllib
from pathlib import Path

from lighthouse.models import TechFingerprint

_EXT_TO_LANG = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".rb": "ruby",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".hpp": "cpp",
    ".c": "c",
    ".h": "c",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".php": "php",
}

_SKIP_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "env",
    "dist",
    "build",
    "target",
    "__pycache__",
    ".next",
    "out",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".egg-info",
}

DOMAIN_KEYWORDS: dict[str, list[str]] = {
    "logistics": ["freight", "shipment", "fleet", "route", "warehouse", "dispatch", "carrier"],
    "fintech": ["payment", "ledger", "invoice", "wallet", "trading", "settlement"],
    "devtools": ["cli", "sdk", "debugger", "compiler", "linter", "devtool"],
    "health": ["medical", "patient", "ehr", "clinical", "wellness", "telehealth"],
    "edtech": ["student", "curriculum", "learning", "course", "tutor", "classroom"],
    "security": ["cve", "vuln", "exploit", "firewall", "malware", "pentest"],
    "ai": ["llm", "prompt", "embedding", "inference", "agent", "model"],
    "infra": ["kubernetes", "docker", "terraform", "cluster", "orchestrat"],
    "data": ["etl", "pipeline", "analytics", "warehouse", "olap", "lakehouse"],
    "commerce": ["cart", "checkout", "storefront", "merchant", "inventory", "ecommerce"],
}

_URL_SCHEMES = ("http://", "https://", "git@", "ssh://")


class RepoAnalyzer:
    def analyze(self, source: str) -> TechFingerprint:
        if source.startswith(_URL_SCHEMES) or source.endswith(".git"):
            with tempfile.TemporaryDirectory() as tmp:
                dest = Path(tmp) / "repo"
                subprocess.run(
                    ["git", "clone", "--depth", "50", source, str(dest)],
                    check=True,
                    capture_output=True,
                )
                return self._analyze_path(dest)
        return self._analyze_path(Path(source))

    def _analyze_path(self, root: Path) -> TechFingerprint:
        return TechFingerprint(
            languages=self._languages(root),
            frameworks=self._frameworks(root),
            domain_hints=self._domain_hints(root),
            recent_commit_themes=self._commit_themes(root),
            readme_summary=self._readme_summary(root),
        )

    def _iter_files(self, root: Path):
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part in _SKIP_DIRS or part.endswith(".egg-info") for part in path.parts):
                continue
            yield path

    def _languages(self, root: Path) -> list[str]:
        found: set[str] = set()
        for path in self._iter_files(root):
            lang = _EXT_TO_LANG.get(path.suffix.lower())
            if lang:
                found.add(lang)
        return sorted(found)

    def _frameworks(self, root: Path) -> list[str]:
        names: set[str] = set()
        pkg = root / "package.json"
        if pkg.is_file():
            try:
                data = json.loads(pkg.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                data = {}
            for key in ("dependencies", "devDependencies", "peerDependencies"):
                for name in (data.get(key) or {}):
                    names.add(name.lower())

        pyp = root / "pyproject.toml"
        if pyp.is_file():
            try:
                data = tomllib.loads(pyp.read_text(encoding="utf-8"))
            except tomllib.TOMLDecodeError:
                data = {}
            deps = data.get("project", {}).get("dependencies", []) or []
            for spec in deps:
                names.add(self._dep_name(spec))
            for group in (data.get("project", {}).get("optional-dependencies") or {}).values():
                for spec in group:
                    names.add(self._dep_name(spec))

        cargo = root / "Cargo.toml"
        if cargo.is_file():
            try:
                data = tomllib.loads(cargo.read_text(encoding="utf-8"))
            except tomllib.TOMLDecodeError:
                data = {}
            for name in (data.get("dependencies") or {}):
                names.add(name.lower())

        gomod = root / "go.mod"
        if gomod.is_file():
            text = gomod.read_text(encoding="utf-8", errors="ignore")
            for match in re.finditer(r"^\s*([\w\./-]+)\s+v[\d\.]+", text, flags=re.MULTILINE):
                names.add(match.group(1).lower())

        names.discard("")
        return sorted(names)

    @staticmethod
    def _dep_name(spec: str) -> str:
        return re.split(r"[<>=!~;\[\s]", spec, maxsplit=1)[0].strip().lower()

    def _domain_hints(self, root: Path) -> list[str]:
        readme = self._read_readme(root).lower()
        hits: list[str] = []
        for domain, kws in DOMAIN_KEYWORDS.items():
            if any(kw in readme for kw in kws):
                hits.append(domain)
        return hits

    def _commit_themes(self, root: Path) -> list[str]:
        try:
            toplevel = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            if Path(toplevel).resolve() != root.resolve():
                return []
            result = subprocess.run(
                ["git", "-C", str(root), "log", "--oneline", "-n", "50"],
                check=True,
                capture_output=True,
                text=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError):
            return []
        themes: list[str] = []
        for line in result.stdout.splitlines():
            parts = line.split(" ", 1)
            if len(parts) == 2:
                themes.append(parts[1].strip())
        return themes

    def _read_readme(self, root: Path) -> str:
        for name in ("README.md", "README.rst", "README.txt", "README"):
            path = root / name
            if path.is_file():
                return path.read_text(encoding="utf-8", errors="ignore")
        return ""

    def _readme_summary(self, root: Path) -> str:
        return self._read_readme(root)[:600]
