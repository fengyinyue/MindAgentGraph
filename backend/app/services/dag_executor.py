"""Sequential DAG execution for MVP graph runs."""

from __future__ import annotations

import json
from collections import deque
from typing import AsyncIterator

from app.schemas import Edge, Graph, Node
from app.services.memory import read_memory, write_memory
from app.services.runner import run_node_stream


def sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def topological_sort(nodes: list[Node], links: list[Edge]) -> list[str]:
    ids = {node.id for node in nodes}
    indegree = {node.id: 0 for node in nodes}
    outgoing = {node.id: [] for node in nodes}

    for link in links:
        if link.source not in ids or link.target not in ids:
            continue
        indegree[link.target] += 1
        outgoing[link.source].append(link.target)

    queue = deque([node.id for node in nodes if indegree[node.id] == 0])
    order: list[str] = []

    while queue:
        node_id = queue.popleft()
        order.append(node_id)
        for target in outgoing[node_id]:
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)

    if len(order) != len(nodes):
        raise ValueError("图中存在循环依赖，无法按 DAG 顺序执行。")

    return order


def _node_purpose(node: Node) -> str:
    if node.purpose:
        return node.purpose
    raw = node.data.get("purpose")
    return raw if isinstance(raw, str) else ""


def _output_key(node: Node) -> str:
    return f"{node.title} ({node.id})"


async def run_dag_stream(
    *,
    graph: Graph,
    project_path: str | None,
    provider: str | None,
    model: str | None,
    api_key: str | None,
    allow_code: bool = False,
) -> AsyncIterator[str]:
    nodes_by_id = {node.id: node for node in graph.nodes}
    parent_ids: dict[str, list[str]] = {node.id: [] for node in graph.nodes}
    for link in graph.links:
        if link.source in nodes_by_id and link.target in nodes_by_id:
            parent_ids[link.target].append(link.source)

    order = topological_sort(graph.nodes, graph.links)
    results: dict[str, str] = {}

    yield sse("log", {
        "level": "info",
        "source": "dag",
        "status": "START",
        "message": f"开始执行 DAG，共 {len(order)} 个节点。",
    })

    for node_id in order:
        node = nodes_by_id[node_id]
        if node.type == "code" and not allow_code:
            yield sse("log", {
                "level": "warn",
                "source": "dag",
                "status": "SKIPPED",
                "nodeId": node.id,
                "nodeTitle": node.title,
                "message": "跳过 Code 节点批量执行。",
            })
            yield sse("progress", {
                "nodeId": node.id,
                "nodeTitle": node.title,
                "status": "skipped",
                "message": "MVP 默认跳过 Code 节点批量执行。",
            })
            continue

        yield sse("log", {
            "level": "info",
            "source": "dag",
            "status": "RUNNING",
            "nodeId": node.id,
            "nodeTitle": node.title,
            "message": f"开始执行节点 {node.title}",
        })
        yield sse("progress", {
            "nodeId": node.id,
            "nodeTitle": node.title,
            "status": "running",
            "message": "running",
        })

        parent_outputs = {
            _output_key(nodes_by_id[parent_id]): results[parent_id]
            for parent_id in parent_ids[node.id]
            if parent_id in results and results[parent_id].strip()
        }

        memory_text = None
        if node.contextMode == "inherit":
            memory_text = read_memory(project_path, node.memoryRef)

        output_parts: list[str] = []
        try:
            async for chunk in run_node_stream(
                node_title=node.title,
                node_type=node.type,
                node_purpose=_node_purpose(node),
                user_prompt=None,
                context_mode=node.contextMode,
                parent_outputs=parent_outputs or None,
                memory_text=memory_text,
                system_prompt=node.systemPrompt,
                provider=provider,
                model=model,
                api_key=api_key,
            ):
                output_parts.append(chunk)
                yield sse("text", {"nodeId": node.id, "chunk": chunk})

            output = "".join(output_parts)
            results[node.id] = output
            if node.contextMode != "isolated":
                write_memory(project_path, node.memoryRef, output, node_title=node.title)

            yield sse("progress", {
                "nodeId": node.id,
                "nodeTitle": node.title,
                "status": "done",
                "message": "done",
                "output": output,
            })
            yield sse("log", {
                "level": "info",
                "source": "dag",
                "status": "DONE",
                "nodeId": node.id,
                "nodeTitle": node.title,
                "message": f"节点完成，输出 {len(output)} 字符。",
            })
        except Exception as exc:  # noqa: BLE001
            yield sse("progress", {
                "nodeId": node.id,
                "nodeTitle": node.title,
                "status": "error",
                "message": str(exc),
            })
            yield sse("log", {
                "level": "error",
                "source": "dag",
                "status": "ERROR",
                "nodeId": node.id,
                "nodeTitle": node.title,
                "message": str(exc),
            })
            yield sse("error", {"message": str(exc), "nodeId": node.id, "nodeTitle": node.title})
            return

    yield sse("log", {
        "level": "info",
        "source": "dag",
        "status": "DONE",
        "message": f"DAG 执行完成，得到 {len(results)} 个节点输出。",
    })
    yield sse("done", {"results": results})
