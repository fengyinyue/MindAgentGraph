import asyncio
from typing import Any

import pytest

from app.services import planner
from app.services.planner import expand_plan
from app.services.providers.base import ProviderError


class FakePcgProvider:
    name = "fake-pcg"

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.calls: list[dict[str, Any]] = []

    async def emit_graph(
        self,
        *,
        system_prompt: str,
        user_goal: str,
        tool_schema: dict[str, Any],
        model: str | None = None,
        api_key: str | None = None,
    ) -> dict[str, Any]:
        self.calls.append({
            "system_prompt": system_prompt,
            "user_goal": user_goal,
            "tool_schema": tool_schema,
            "model": model,
            "api_key": api_key,
        })
        return self.payload


def valid_pcg_payload() -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": "bounds_spline_input",
                "type": "asset",
                "title": "Input: Bounds Spline",
                "x": 0,
                "y": 0,
                "purpose": "Provide a city boundary spline.",
                "inputs": [],
                "outputs": [{"id": "bounds_spline", "name": "Bounds Spline", "type": "spline"}],
            },
            {
                "id": "spline_to_bounds",
                "type": "code",
                "title": "PCG: Spline To Bounds",
                "x": 320,
                "y": 0,
                "purpose": "Convert the bounds spline into polygon bounds.",
                "inputs": [{"id": "bounds_spline", "name": "Bounds Spline", "type": "spline"}],
                "outputs": [{"id": "bounds_polygon", "name": "Bounds Polygon", "type": "polygon"}],
            },
            {
                "id": "generate_grid_seeds",
                "type": "code",
                "title": "PCG: Generate Grid Seeds",
                "x": 640,
                "y": 0,
                "purpose": "Generate candidate road points inside the bounds.",
                "inputs": [{"id": "bounds_polygon", "name": "Bounds Polygon", "type": "polygon"}],
                "outputs": [{"id": "grid_seeds", "name": "Grid Seeds", "type": "point"}],
            },
            {
                "id": "debug_preview",
                "type": "task",
                "title": "Debug: Preview",
                "x": 960,
                "y": 0,
                "purpose": "Preview the generated PCG points.",
                "inputs": [{"id": "grid_seeds", "name": "Grid Seeds", "type": "point"}],
                "outputs": [{"id": "debug_preview", "name": "Debug Preview", "type": "debug"}],
            },
        ],
        "links": [
            {
                "source": "bounds_spline_input",
                "sourceHandle": "bounds_spline",
                "target": "spline_to_bounds",
                "targetHandle": "bounds_spline",
                "label": "Bounds Spline",
            },
            {
                "source": "spline_to_bounds",
                "sourceHandle": "bounds_polygon",
                "target": "generate_grid_seeds",
                "targetHandle": "bounds_polygon",
                "label": "Bounds Polygon",
            },
            {
                "source": "generate_grid_seeds",
                "sourceHandle": "grid_seeds",
                "target": "debug_preview",
                "targetHandle": "grid_seeds",
                "label": "Grid Seeds",
            },
        ],
    }


def test_expand_plan_generates_pcg_graph_with_ai_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakePcgProvider(valid_pcg_payload())
    monkeypatch.setitem(planner._PROVIDERS, "fake-pcg", fake)

    result = asyncio.run(
        expand_plan(
            """
            Use PCG to generate city road points inside a bounds spline.
            The graph should decide the needed PCG nodes and connect data ports.
            """,
            provider="fake-pcg",
            model="test-model",
            api_key="test-key",
        )
    )

    assert len(fake.calls) == 1
    assert fake.calls[0]["system_prompt"] == planner.PCG_EXPAND_SYSTEM
    assert "Controlled PCG node library" in fake.calls[0]["system_prompt"]
    assert fake.calls[0]["model"] == "test-model"
    assert fake.calls[0]["api_key"] == "test-key"
    assert [node["id"] for node in result["nodes"]] == [
        "bounds_spline_input",
        "spline_to_bounds",
        "generate_grid_seeds",
        "debug_preview",
    ]
    assert {node["type"] for node in result["nodes"]} == {"asset", "code", "task"}
    assert all(node["type"] != "semantic" for node in result["nodes"])

    by_id = {node["id"]: node for node in result["nodes"]}
    assert by_id["bounds_spline_input"]["x"] < by_id["spline_to_bounds"]["x"]
    assert by_id["spline_to_bounds"]["x"] < by_id["generate_grid_seeds"]["x"]
    assert by_id["generate_grid_seeds"]["x"] < by_id["debug_preview"]["x"]

    output_ports = {
        node["id"]: {port["id"] for port in node["outputs"]}
        for node in result["nodes"]
    }
    input_ports = {
        node["id"]: {port["id"] for port in node["inputs"]}
        for node in result["nodes"]
    }
    for link in result["links"]:
        assert link["sourceHandle"] in output_ports[link["source"]]
        assert link["targetHandle"] in input_ports[link["target"]]
        assert link["label"]


def test_expand_plan_pcg_unknown_provider_raises() -> None:
    with pytest.raises(ProviderError, match="unknown provider"):
        asyncio.run(
            expand_plan(
                "Use PCG to generate a road network from a bounds spline.",
                provider="missing-provider",
            )
        )


def test_expand_plan_pcg_rejects_missing_link_handles(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = valid_pcg_payload()
    del payload["links"][0]["sourceHandle"]
    monkeypatch.setitem(planner._PROVIDERS, "fake-pcg", FakePcgProvider(payload))

    with pytest.raises(ProviderError, match="sourceHandle"):
        asyncio.run(
            expand_plan(
                "Use PCG to generate a road network from a bounds spline.",
                provider="fake-pcg",
            )
        )


def test_expand_plan_pcg_rejects_link_handle_that_does_not_match_port(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = valid_pcg_payload()
    payload["links"][0]["targetHandle"] = "missing_port"
    monkeypatch.setitem(planner._PROVIDERS, "fake-pcg", FakePcgProvider(payload))

    with pytest.raises(ProviderError, match="targetHandle"):
        asyncio.run(
            expand_plan(
                "Use PCG to generate a road network from a bounds spline.",
                provider="fake-pcg",
            )
        )


def test_expand_plan_pcg_rejects_semantic_nodes(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = valid_pcg_payload()
    payload["nodes"][1]["type"] = "semantic"
    monkeypatch.setitem(planner._PROVIDERS, "fake-pcg", FakePcgProvider(payload))

    with pytest.raises(ProviderError, match="semantic"):
        asyncio.run(
            expand_plan(
                "Use PCG to generate a road network from a bounds spline.",
                provider="fake-pcg",
            )
        )
