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


def _has_confirmation_request(output: str) -> bool:
    return "```mag-confirmation" in output.lower()


def _subgraph_nodes(root_id: str, nodes_by_id: dict[str, Node], outgoing: dict[str, list[str]]) -> set[str]:
    """Return the set of node IDs reachable from root_id (downstream only)."""
    reachable: set[str] = set()
    queue = deque([root_id])
    while queue:
        nid = queue.popleft()
        if nid in reachable:
            continue
        reachable.add(nid)
        for target in outgoing.get(nid, []):
            if target not in reachable:
                queue.append(target)
    return reachable


async def run_dag_stream(
    *,
    graph: Graph,
    project_path: str | None,
    provider: str | None,
    model: str | None,
    api_key: str | None,
    allow_code: bool = False,
    root_node_id: str | None = None,
) -> AsyncIterator[str]:
    nodes_by_id = {node.id: node for node in graph.nodes}
    parent_ids: dict[str, list[str]] = {node.id: [] for node in graph.nodes}
    outgoing: dict[str, list[str]] = {node.id: [] for node in graph.nodes}
    for link in graph.links:
        if link.source in nodes_by_id and link.target in nodes_by_id:
            parent_ids[link.target].append(link.source)
            outgoing[link.source].append(link.target)

    if root_node_id is not None:
        if root_node_id not in nodes_by_id:
            yield sse("error", {"message": f"root node {root_node_id} not found"})
            return
        sub_ids = _subgraph_nodes(root_node_id, nodes_by_id, outgoing)
        sub_nodes = [nodes_by_id[nid] for nid in sub_ids]
        sub_links = [l for l in graph.links if l.source in sub_ids and l.target in sub_ids]
        root_node = nodes_by_id[root_node_id]
        yield sse("log", {
            "level": "info",
            "source": "dag",
            "status": "START",
            "message": f"从 {root_node.title} 开始执行子树，共 {len(sub_nodes)} 个节点。",
        })
    else:
        sub_nodes = graph.nodes
        sub_links = graph.links
        yield sse("log", {
            "level": "info",
            "source": "dag",
            "status": "START",
            "message": f"开始执行 DAG，共 {len(sub_nodes)} 个节点。",
        })

    order = topological_sort(sub_nodes, sub_links)
    results: dict[str, str] = {}

    # Pre-seed with root node's existing output so children can inherit it
    if root_node_id is not None:
        root_node = nodes_by_id[root_node_id]
        root_output = root_node.output or ""
        if root_output.strip():
            results[root_node_id] = root_output

    for node_id in order:
        node = nodes_by_id[node_id]
        if node.type in {"planning", "workflow_graph", "structure_graph"}:
            yield sse("log", {
                "level": "warn",
                "source": "dag",
                "status": "SKIPPED",
                "nodeId": node.id,
                "nodeTitle": node.title,
                "message": "跳过 Planning 节点；项目结构已由生成节点图阶段完成。",
            })
            yield sse("progress", {
                "nodeId": node.id,
                "nodeTitle": node.title,
                "status": "skipped",
                "message": "Planning 节点不执行 Explain。",
            })
            continue

        if node.type == "project_scan":
            yield sse("log", {
                "level": "warn",
                "source": "dag",
                "status": "SKIPPED",
                "nodeId": node.id,
                "nodeTitle": node.title,
                "message": "跳过 Project Scan 节点；请先单独选择工程目录并执行扫描。",
            })
            yield sse("progress", {
                "nodeId": node.id,
                "nodeTitle": node.title,
                "status": "skipped",
                "message": "Project Scan 需要 projectDir，MVP 中请单独执行。",
            })
            continue

        if node.type == "code_analysis":
            yield sse("log", {
                "level": "warn",
                "source": "dag",
                "status": "SKIPPED",
                "nodeId": node.id,
                "nodeTitle": node.title,
                "message": "跳过 Code Analysis 节点；请先单独选择工程目录并执行只读分析。",
            })
            yield sse("progress", {
                "nodeId": node.id,
                "nodeTitle": node.title,
                "status": "skipped",
                "message": "Code Analysis 需要 projectDir，MVP 中请单独执行。",
            })
            continue

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
            if _has_confirmation_request(output):
                yield sse("progress", {
                    "nodeId": node.id,
                    "nodeTitle": node.title,
                    "status": "needs_confirmation",
                    "message": "节点需要用户确认，DAG 已暂停。",
                    "output": output,
                })
                yield sse("log", {
                    "level": "warn",
                    "source": "dag",
                    "status": "NEEDS_CONFIRMATION",
                    "nodeId": node.id,
                    "nodeTitle": node.title,
                    "message": "节点需要用户确认，确认后再继续执行。",
                })
                yield sse("done", {"results": results, "pausedAt": node.id})
                return

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
