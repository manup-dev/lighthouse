"""MCP stdio server for Lighthouse.

Exposes a single tool, ``lighthouse_investors_for_repo``, that runs the full
match pipeline (investors + design partners + senior hires) for a GitHub repo
and returns the ``MatchResult`` as indented JSON text.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

from dotenv import load_dotenv
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from lighthouse.cli import _DryRunCrust
from lighthouse.crust_client import CrustClient
from lighthouse.llm import make_llm
from lighthouse.pipeline import Pipeline

TOOL_NAME = "lighthouse_investors_for_repo"
TOOL_DESCRIPTION = (
    "Find 5 investors, 5 design partners, and 5 senior hires for a GitHub "
    "repo, each with a warm-intro draft grounded in a recent public post."
)
TOOL_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "repo_url": {
            "type": "string",
            "description": "GitHub repo URL or local path",
        },
        "location": {
            "type": "string",
            "description": "City for Talent-track geo_distance, default Bangalore",
        },
    },
    "required": ["repo_url"],
}


def _build_crust() -> Any:
    """Return a real CrustClient if CRUSTDATA_API_KEY is set, else a dry-run stub."""
    api_key = os.environ.get("CRUSTDATA_API_KEY")
    if api_key:
        return CrustClient(api_key=api_key)
    return _DryRunCrust()


def _build_pipeline(llm: Any, crust: Any) -> Pipeline:
    """Pipeline factory. Patched in tests to inject a fake pipeline."""
    return Pipeline(llm=llm, crust=crust)


def build_server() -> Server:
    """Construct the MCP Server and register handlers.

    Returned so tests can invoke handlers directly without stdio.
    """
    server: Server = Server("lighthouse-mcp")

    @server.list_tools()
    async def list_tools() -> list[Tool]:
        return [
            Tool(
                name=TOOL_NAME,
                description=TOOL_DESCRIPTION,
                inputSchema=TOOL_INPUT_SCHEMA,
            )
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
        if name != TOOL_NAME:
            raise ValueError(f"unknown tool: {name!r}")
        repo_url = arguments["repo_url"]
        location = arguments.get("location") or "Bangalore"

        llm = make_llm()
        crust = _build_crust()
        pipeline = _build_pipeline(llm, crust)
        result = await pipeline.run(repo_url, location=location)
        return [TextContent(type="text", text=result.model_dump_json(indent=2))]

    # Attach handlers to the server object so tests can reach them by name.
    server._lighthouse_list_tools = list_tools  # type: ignore[attr-defined]
    server._lighthouse_call_tool = call_tool  # type: ignore[attr-defined]
    return server


async def _run_stdio() -> None:
    load_dotenv()
    server = build_server()
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


def main() -> None:
    """Entry point for ``lighthouse-mcp`` console script."""
    asyncio.run(_run_stdio())


if __name__ == "__main__":
    main()
