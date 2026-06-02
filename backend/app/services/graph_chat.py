from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator

from app.schemas import ChatMessage, Graph, GraphEditResult
from app.services.planner import DEFAULT_MODELS, DEFAULT_PROVIDER, _PROVIDERS
from app.services.providers.base import ProviderError

_log = logging.getLogger("mag.graph_chat")

GRAPH_EDIT_SYSTEM = """你是 MindAgentGraph 的图表编辑助手。

用户会用自然语言要求你编辑当前工程图。你必须返回结构化 graph edit patch，不要返回自由文本。

你只能做这些操作：
- createNodes: 创建新节点
- updateNodes: 更新已有节点标题、purpose、summary、data.status 或 metadata
- deleteNodeIds: 删除已有节点
- createLinks: 创建连线
- deleteLinkIds: 删除已有连线

重要规则：
1. 不要输出完整 graph，只输出用户要求的最小补丁。
2. 引用已有节点时必须使用上下文中的真实 id。
3. 新节点可以使用 clientId，后续 createLinks 可以引用这个 clientId。
4. 节点 type 只能使用允许类型。
5. 如果用户要求含糊，少做推测，在 reply 中说明需要更多信息。
6. 如果用户用中文，reply、title、purpose 尽量使用中文。
7. createLinks 的 source/target 可以是已有 id 或本次 createNodes 中的 clientId。
8. 不要修改项目源代码文件；这里只编辑图表。
9. 新建多个节点时默认从左到右横向排布：同一批节点 y 尽量相同，x 逐个递增，节点间距建议 260-320。
10. 如果需要表达流程顺序，也优先使用从左到右的连线方向，而不是从上到下。
"""

GRAPH_CHAT_STREAM_SYSTEM = """你是 MindAgentGraph 的图表编辑助手。

你正在和用户协作编辑当前工程图。请用简短、自然的中文回复用户正在做什么。

重要：
1. 你可以参考历史对话和当前图上下文。
2. 不要输出 JSON，不要输出 patch，不要编造已经完成的变更数量。
3. 如果用户要求编辑图，请说明你将如何更新图表。
4. 如果用户要求含糊，请说明需要补充的信息。
5. 回复保持简洁，通常 1-4 句。
"""

GRAPH_EDIT_TOOL = {
    "name": "emit_graph_edit",
    "description": "Emit a minimal graph edit patch.",
    "input_schema": {
        "type": "object",
        "required": ["reply"],
        "properties": {
            "reply": {"type": "string"},
            "createNodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["clientId", "type", "title"],
                    "properties": {
                        "clientId": {"type": "string"},
                        "type": {
                            "type": "string",
                            "enum": [
                                "prompt", "planning", "subgraph", "memory", "filescope",
                                "analysis", "code", "api", "asset", "agent", "task", "semantic",
                            ],
                        },
                        "title": {"type": "string"},
                        "purpose": {"type": "string"},
                        "summary": {"type": "string"},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "data": {"type": "object"},
                        "metadata": {"type": "object"},
                    },
                },
            },
            "updateNodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["id"],
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                        "purpose": {"type": "string"},
                        "summary": {"type": "string"},
                        "type": {"type": "string"},
                        "data": {"type": "object"},
                        "metadata": {"type": "object"},
                    },
                },
            },
            "deleteNodeIds": {"type": "array", "items": {"type": "string"}},
            "createLinks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["source", "target"],
                    "properties": {
                        "source": {"type": "string"},
                        "target": {"type": "string"},
                        "label": {"type": "string"},
                        "sourceHandle": {"type": "string"},
                        "targetHandle": {"type": "string"},
                    },
                },
            },
            "deleteLinkIds": {"type": "array", "items": {"type": "string"}},
        },
    },
}


async def edit_graph_with_chat(
    *,
    message: str,
    history: list[ChatMessage] | None = None,
    graph: Graph,
    active_parent_id: str | None,
    provider: str | None,
    model: str | None,
    api_key: str | None,
) -> GraphEditResult:
    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")
    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)

    user_goal = _build_user_goal(
        message=message,
        history=history or [],
        graph=graph,
        active_parent_id=active_parent_id,
    )
    payload = await impl.emit_graph(
        system_prompt=GRAPH_EDIT_SYSTEM,
        user_goal=user_goal,
        tool_schema=GRAPH_EDIT_TOOL,
        model=chosen_model,
        api_key=api_key,
    )
    result = _sanitize_payload(payload, graph)
    _log.debug(
        "graph edit provider=%s create=%s update=%s links=%s",
        chosen,
        len(result.createNodes),
        len(result.updateNodes),
        len(result.createLinks),
    )
    return result


async def stream_graph_chat_reply(
    *,
    message: str,
    history: list[ChatMessage] | None,
    graph: Graph,
    active_parent_id: str | None,
    provider: str | None,
    model: str | None,
    api_key: str | None,
) -> AsyncIterator[str]:
    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")
    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)
    user_message = _build_user_goal(
        message=message,
        history=history or [],
        graph=graph,
        active_parent_id=active_parent_id,
    )
    async for chunk in impl.stream_text(
        system_prompt=GRAPH_CHAT_STREAM_SYSTEM,
        user_message=user_message,
        model=chosen_model,
        api_key=api_key,
        max_tokens=900,
    ):
        yield chunk


def _build_user_goal(
    *,
    message: str,
    history: list[ChatMessage],
    graph: Graph,
    active_parent_id: str | None,
) -> str:
    visible_nodes = [node for node in graph.nodes if (node.parentId or None) == active_parent_id]
    if not visible_nodes:
        visible_nodes = graph.nodes

    nodes = [
        {
            "id": node.id,
            "type": node.type,
            "title": node.title,
            "purpose": node.purpose,
            "status": node.data.get("status") if isinstance(node.data, dict) else None,
            "parentId": node.parentId,
            "x": node.position.x,
            "y": node.position.y,
        }
        for node in visible_nodes[:80]
    ]
    links = [
        {
            "id": link.id,
            "source": link.source,
            "target": link.target,
            "label": link.label,
        }
        for link in graph.links[:120]
    ]
    context = {
        "activeParentId": active_parent_id,
        "nodes": nodes,
        "links": links,
    }
    return "\n".join([
        "## 最近对话",
        _format_history(history),
        "",
        "## 用户指令",
        message,
        "",
        "## 当前图上下文 JSON",
        json.dumps(context, ensure_ascii=False),
    ])


def _format_history(history: list[ChatMessage]) -> str:
    if not history:
        return "无"
    lines: list[str] = []
    for msg in history[-12:]:
        content = msg.content.strip()
        if not content:
            continue
        lines.append(f"{msg.role}: {content[:1200]}")
    return "\n".join(lines) if lines else "无"


def _sanitize_payload(payload: dict[str, Any], graph: Graph) -> GraphEditResult:
    node_ids = {node.id for node in graph.nodes}
    link_ids = {link.id for link in graph.links}

    create_nodes = _list_of_dicts(payload.get("createNodes"))
    update_nodes = [
        node for node in _list_of_dicts(payload.get("updateNodes"))
        if isinstance(node.get("id"), str) and node["id"] in node_ids
    ]
    delete_node_ids = [
        node_id for node_id in _list_of_strings(payload.get("deleteNodeIds"))
        if node_id in node_ids
    ]
    create_client_ids = {
        str(node.get("clientId"))
        for node in create_nodes
        if isinstance(node.get("clientId"), str) and node.get("clientId")
    }
    create_links = [
        link for link in _list_of_dicts(payload.get("createLinks"))
        if _is_node_ref(link.get("source"), node_ids, create_client_ids)
        and _is_node_ref(link.get("target"), node_ids, create_client_ids)
        and link.get("source") != link.get("target")
    ]
    delete_link_ids = [
        link_id for link_id in _list_of_strings(payload.get("deleteLinkIds"))
        if link_id in link_ids
    ]

    return GraphEditResult(
        reply=str(payload.get("reply") or "已生成图表编辑建议。"),
        createNodes=create_nodes[:30],
        updateNodes=update_nodes[:50],
        deleteNodeIds=delete_node_ids[:50],
        createLinks=create_links[:60],
        deleteLinkIds=delete_link_ids[:60],
    )


def _is_node_ref(value: Any, node_ids: set[str], client_ids: set[str]) -> bool:
    return isinstance(value, str) and (value in node_ids or value in client_ids)


def _list_of_dicts(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _list_of_strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]
