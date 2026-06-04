"""一句话 → 节点树 (DAG)。

核心思路：用 tool_use / tool_choice 强约束输出 schema，避免自由文本解析失败。
provider 抽象在 [providers/](providers/)：MVP 支持 anthropic / openai / deepseek / local CLI。
"""

from __future__ import annotations
import logging
import os
import uuid
from typing import Any

from app.schemas import Graph, Node, Edge, Position
from app.services.providers.base import PlanProvider, ProviderError
from app.services.providers.anthropic_provider import AnthropicProvider
from app.services.providers.deepseek_provider import DeepSeekProvider
from app.services.providers.local_cli_provider import LocalCliProvider
from app.services.providers.openai_provider import OpenAIProvider

_log = logging.getLogger("mag.planner")

# 默认 provider/model 来自 env，请求体可以覆盖。
DEFAULT_PROVIDER = os.environ.get("MAG_PROVIDER", "anthropic")
DEFAULT_MODELS = {
    "anthropic": os.environ.get("MAG_MODEL_ANTHROPIC", "claude-sonnet-4-6"),
    "deepseek": os.environ.get("MAG_MODEL_DEEPSEEK", "deepseek-v4-flash"),
    "openai": os.environ.get("MAG_MODEL_OPENAI", "gpt-4.1"),
    "local-claude": os.environ.get("MAG_MODEL_LOCAL_CLAUDE", "sonnet"),
    "local-codex": os.environ.get("MAG_MODEL_LOCAL_CODEX", ""),
}

PLANNER_SYSTEM = """你是 MindAgentGraph 的项目规划助手。

你的任务：把用户的一句话目标，拆解成一个由"思维节点"组成的 DAG (有向无环图)。

节点类型说明：
- planning: 高层工作流规划/总控节点（通常是根节点）
- subgraph: 结构化数据流/依赖图入口节点
- prompt: 与 AI 对话生成内容的节点
- code: 代码实现节点
- analysis: 使用 Claude Code 只读分析已有代码，输出架构理解、实现入口、风险和建议改动范围
- asset: 资源/素材节点
- task: 待办任务节点
- memory: 记忆/上下文节点
- filescope: 文件作用域定义

设计原则：
1. 5-12 个节点，覆盖目标的关键模块
2. 每个节点应有清晰的单一职责
3. 用 links 表达数据依赖（A 的输出是 B 的输入）
4. 节点位置 (position) 要分散。layout 从左到右：上游节点在左，下游节点在右，父子节点 x 间距 ≥ 280
5. 根节点放在 (0,0)，下游节点向右展开；并行分支用 y 上下错开

必须用 emit_graph 工具返回结构化结果，不要写自由文本。"""


MODULE_GRAPH_SYSTEM = """你是 MindAgentGraph 的模块依赖分析助手。

你的任务：根据已有的代码分析文本，生成一个模块依赖图 (DAG)。

代码分析文本中描述了项目的模块结构、文件组织、组件依赖关系。你需要将这些信息转化为结构化节点图。

节点类型说明：
- code: 代表一个代码模块/包/组件
- task: 代表一个需要完成的改动任务
- prompt: 代表需要进一步分析或设计的模块
- filescope: 需要特别关注的文件范围

设计原则：
1. 每个模块独立为一个节点
2. 用 links 表达模块间的依赖关系 (A depends on B → link source=B, target=A)
3. 节点位置 (position) 要分散。依赖关系从左到右排列，父子节点 x 间距 ≥ 280
4. 根模块放在 (0,0)，依赖链向右展开，并行模块用 y 上下错开
5. 节点 title 尽量使用模块/文件的相对路径名或组件名
6. 节点的 purpose 字段描述该模块的职责和代码分析的发现

必须用 emit_graph 工具返回结构化结果，不要写自由文本。"""


EMIT_GRAPH_TOOL = {
    "name": "emit_graph",
    "description": "Emit the planned node graph as structured JSON.",
    "input_schema": {
        "type": "object",
        "required": ["nodes", "links"],
        "properties": {
            "nodes": {
                "type": "array",
                "items": {"$ref": "#/$defs/graphNode"},
            },
            "links": {
                "type": "array",
                "items": {"$ref": "#/$defs/graphLink"},
            },
        },
        "$defs": {
            "graphNode": {
                "type": "object",
                "required": ["id", "type", "title", "x", "y"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": [
                            "prompt", "planning", "subgraph", "memory", "filescope",
                            "analysis", "code", "api", "asset", "agent", "task",
                        ],
                    },
                    "title": {"type": "string"},
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                    "purpose": {"type": "string", "description": "What this node does"},
                    "inputs": {"type": "array", "items": {"$ref": "#/$defs/dataPort"}},
                    "outputs": {"type": "array", "items": {"$ref": "#/$defs/dataPort"}},
                    "children": {
                        "type": "object",
                        "description": "Only valid when type='subgraph'. The dataflow nodes/links living inside this subgraph. Inner ids must be globally unique.",
                        "properties": {
                            "nodes": {"type": "array", "items": {"$ref": "#/$defs/graphNode"}},
                            "links": {"type": "array", "items": {"$ref": "#/$defs/graphLink"}},
                        },
                    },
                },
            },
            "graphLink": {
                "type": "object",
                "required": ["source", "target"],
                "properties": {
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "sourceHandle": {"type": "string"},
                    "targetHandle": {"type": "string"},
                    "label": {"type": "string", "description": "Data passed from source to target."},
                },
            },
            "dataPort": {
                "type": "object",
                "required": ["id", "name", "type"],
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": ["spline", "point", "polygon", "bounds", "graph", "debug", "asset", "unknown"],
                    },
                },
            },
        },
    },
}

_PROVIDERS: dict[str, PlanProvider] = {
    "anthropic": AnthropicProvider(),
    "deepseek": DeepSeekProvider(),
    "openai": OpenAIProvider(),
    "local-claude": LocalCliProvider("claude"),
    "local-codex": LocalCliProvider("codex"),
}


def _to_internal_graph(payload: dict[str, Any]) -> Graph:
    nodes: list[Node] = []
    for raw in payload.get("nodes", []):
        node_type = _normalize_node_type(raw["type"])
        nodes.append(
            Node(
                id=raw["id"],
                type=node_type,
                title=raw["title"],
                position=Position(x=float(raw["x"]), y=float(raw["y"])),
                contextMode="inherit",
                memoryRef=f"{raw['id']}.md" if node_type == "memory" else None,
                purpose=raw.get("purpose", ""),
                data={
                    "purpose": raw.get("purpose", ""),
                    "inputs": _normalize_ports(raw.get("inputs", []), "input"),
                    "outputs": _normalize_ports(raw.get("outputs", []), "output"),
                },
            )
        )
    links: list[Edge] = []
    for raw in payload.get("links", []):
        links.append(
            Edge(
                id=str(uuid.uuid4()),
                source=raw["source"],
                target=raw["target"],
                sourceHandle=raw.get("sourceHandle"),
                targetHandle=raw.get("targetHandle"),
                label=raw.get("label"),
                channel=None,
            )
        )
    return Graph(nodes=nodes, links=links)


def _normalize_node_type(node_type: Any) -> str:
    value = str(node_type)
    if value == "workflow_graph":
        return "planning"
    if value == "structure_graph":
        return "subgraph"
    if value == "code_analysis":
        return "analysis"
    if value == "project_scan":
        return "analysis"
    return value


def _normalize_ports(raw_ports: Any, prefix: str) -> list[dict[str, str]]:
    if not isinstance(raw_ports, list):
        return []
    ports: list[dict[str, str]] = []
    valid_types = {"spline", "point", "polygon", "bounds", "graph", "debug", "asset", "unknown"}
    for idx, raw in enumerate(raw_ports):
        if isinstance(raw, str):
            ports.append({"id": f"{prefix}_{idx}", "name": raw, "type": "unknown"})
            continue
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or raw.get("id") or f"{prefix} {idx + 1}")
        port_type = str(raw.get("type") or "unknown")
        ports.append({
            "id": str(raw.get("id") or name.lower().replace(" ", "_")),
            "name": name,
            "type": port_type if port_type in valid_types else "unknown",
        })
    return ports


def _sanitize_workflow_payload(
    payload: dict[str, Any],
    *,
    expand_subgraphs: bool = False,
) -> dict[str, object]:
    """Keep workflow expansion as a high-level DAG. Only subgraph nodes carry ports.

    When ``expand_subgraphs`` is True, subgraph nodes may carry a ``children``
    field; those children are flattened into the top-level node list with
    ``parent_id`` pointing back at the subgraph, and their links are appended
    to the top-level links (with handles preserved per structure rules).
    """
    nodes: list[dict[str, Any]] = []
    subgraph_ports: dict[str, dict[str, set[str]]] = {}
    child_nodes: list[dict[str, Any]] = []
    child_node_ports: dict[str, dict[str, set[str]]] = {}
    child_links_raw: list[dict[str, Any]] = []

    for raw in payload.get("nodes", []):
        if not isinstance(raw, dict):
            continue
        node = dict(raw)
        node["type"] = _normalize_node_type(node.get("type"))
        node_id = str(node.get("id") or "")
        if node["type"] == "subgraph":
            inputs = _normalize_ports(node.get("inputs", []), "input")
            outputs = _normalize_ports(node.get("outputs", []), "output")
            node["inputs"] = inputs
            node["outputs"] = outputs
            if node_id:
                subgraph_ports[node_id] = {
                    "inputs": {p["id"] for p in inputs},
                    "outputs": {p["id"] for p in outputs},
                }

            children = node.pop("children", None)
            if expand_subgraphs and isinstance(children, dict) and node_id:
                for child_raw in children.get("nodes", []) or []:
                    if not isinstance(child_raw, dict):
                        continue
                    child = dict(child_raw)
                    child["type"] = _normalize_node_type(child.get("type"))
                    child["parent_id"] = node_id
                    child_inputs = _normalize_ports(child.get("inputs", []), "input")
                    child_outputs = _normalize_ports(child.get("outputs", []), "output")
                    child["inputs"] = child_inputs
                    child["outputs"] = child_outputs
                    child_id = str(child.get("id") or "")
                    if child_id:
                        child_node_ports[child_id] = {
                            "inputs": {p["id"] for p in child_inputs},
                            "outputs": {p["id"] for p in child_outputs},
                        }
                    child_nodes.append(child)
                for link_raw in children.get("links", []) or []:
                    if isinstance(link_raw, dict):
                        child_links_raw.append(link_raw)
            else:
                # Drop unsolicited children: contract requires explicit opt-in.
                pass
        else:
            node["inputs"] = []
            node["outputs"] = []
        nodes.append(node)

    nodes.extend(child_nodes)

    links: list[dict[str, Any]] = []
    for raw in payload.get("links", []):
        if not isinstance(raw, dict):
            continue
        source = raw.get("source")
        target = raw.get("target")
        link: dict[str, Any] = {"source": source, "target": target}

        source_handle = raw.get("sourceHandle")
        if source in subgraph_ports and source_handle in subgraph_ports[source]["outputs"]:
            link["sourceHandle"] = source_handle

        target_handle = raw.get("targetHandle")
        if target in subgraph_ports and target_handle in subgraph_ports[target]["inputs"]:
            link["targetHandle"] = target_handle

        if raw.get("label") is not None:
            link["label"] = raw.get("label")
        links.append(link)

    for raw in child_links_raw:
        source = raw.get("source")
        target = raw.get("target")
        link = {"source": source, "target": target}

        source_handle = raw.get("sourceHandle")
        if source in child_node_ports and source_handle in child_node_ports[source]["outputs"]:
            link["sourceHandle"] = source_handle

        target_handle = raw.get("targetHandle")
        if target in child_node_ports and target_handle in child_node_ports[target]["inputs"]:
            link["targetHandle"] = target_handle

        if raw.get("label") is not None:
            link["label"] = raw.get("label")
        links.append(link)

    return {"nodes": nodes, "links": links}


EXPAND_SYSTEM = """你是 MindAgentGraph 的项目规划助手。

你的任务：根据已有的高层规划文本，将其拆解成一组节点组成的 DAG (有向无环图)。

节点类型选择规则：
- 小/中型项目（单一系统，如"番茄钟"、"Markdown编辑器"）：直接生成实现节点（code、task、prompt），不要创建 planning 子节点
- 大型项目（覆盖多个独立子系统，如"电商平台"、"游戏引擎"）：可以为每个子系统创建一个 planning 节点（后续可各自 Explain + Generate Nodes 展开），子系统之间直接生成实现节点
- 当某个阶段的核心工作是设计结构、数据流、模块依赖、资源/资产管线、生成规则图、Blueprint/节点图、PCG 或可视化流程时，优先生成一个 subgraph 节点作为结构设计入口，而不是直接把该结构拆成多个 code/task 节点
- subgraph 节点应位于后续 code/task/prompt 节点上游；后续实现节点的 purpose 中要明确它依赖 Subgraph 的结构输出
- 不要把 subgraph 用作普通任务清单；只有当下游需要端口化结构、数据流或依赖关系时才使用它
- planning 外层不要重复拆解 subgraph 内部的数据流节点；内部输入/转换/输出节点应留给 Subgraph 自己展开
- 当 planning 中已有 subgraph 时，不要把 Validate/Material/LOD/Collider/Prefab 等内部处理阶段逐个镜像成外层 code 节点；外层 code 节点应是粗粒度工作包，例如"实现管线运行框架"、"根据 Subgraph 实现处理器集合"、"集成导出与报告"、"验证与交付"
- 仅 subgraph 节点需要声明 inputs / outputs 端口（每个端口为 {id, name, type}，type 取值 spline/point/polygon/bounds/graph/debug/asset/unknown），作为该子图对外的接口契约；其他类型节点不要填写端口
- links 涉及 subgraph 的一端，请填写对应的 sourceHandle / targetHandle，且必须命中该 subgraph 已声明的端口 id；非 subgraph 一侧的 handle 请省略
- 工具返回的 links 只能连接本次返回的 nodes；如果需要依赖已有节点，请在新节点 purpose 中明确写"依赖已有节点：<title>"

节点类型说明：
- planning: 仅用于大型项目中独立子系统的规划入口
- subgraph: 用于生成端口化的数据流/结构图入口
- analysis: 使用 Claude Code 只读分析已有代码，输出架构理解、实现入口、风险和建议改动范围
- code: 代码实现节点
- prompt: 与 AI 对话生成内容的节点
- asset: 资源/素材节点
- task: 待办任务节点
- memory: 记忆/上下文节点
- filescope: 文件作用域定义

设计原则：
1. 3-10 个节点，覆盖规划中的关键模块
2. 每个节点应有清晰的单一职责
3. 用 links 表达数据依赖（A 的输出是 B 的输入）
4. 节点位置 (position) 分散。流程从左到右排列，父子节点 x 间距 ≥ 280
5. 根节点放在 (0,0)，下游节点向右展开，并行分支用 y 上下错开
6. 节点的 purpose 字段要具体

必须用 emit_graph 工具返回结构化结果，不要写自由文本。"""


EXPAND_DEEP_SUBGRAPH_SECTION = """深度展开模式（已开启）：

当本次返回包含 subgraph 节点时，必须在该节点的 children 字段里同时输出该 subgraph 的内部数据流：

- children = { nodes: [...], links: [...] }，仅写在 type="subgraph" 节点上
- children.nodes 内部使用结构图规则：
  * 处理/变换节点用 type="code"；输入/资源/产物用 type="asset"；验证/调试/预览用 type="task"；不要用 semantic
  * 每个内部节点必须有完整 inputs / outputs（每个端口 {id, name, type}，type 取值 spline/point/polygon/bounds/graph/debug/asset/unknown）
  * 内部节点的 id 在整个返回里全局唯一，建议用 "<subgraphId>_<role>" 前缀避免冲突
  * 一般 5-12 个节点，从左到右铺开，x 递增表示下游
- children.links 必须每条都填 source / target / sourceHandle / targetHandle / label，且 handle 必须命中对应内部节点已声明的端口 id
- children 内部不要再嵌套 subgraph；如果某层概念也需要数据流，直接平铺到当前 children 里
- subgraph 节点本身仍按外层规则声明 inputs / outputs 作为外部接口；children 里的端口与外部接口的对接关系由用户后续手动连接，不要在 children.links 里跨边界连接

外层（top-level）的 nodes / links 仍遵循原有 workflow 规则：除 subgraph 外不填端口，外层 link 的 handle 仅在端是 subgraph 时填写。"""


STRUCTURE_GRAPH_EXPAND_SYSTEM = """You are a subgraph architect for MindAgentGraph.

Your task is to convert the user's requirement into a structured dataflow or dependency graph.

Use emit_graph and return only structured nodes and links.

Subgraph rules:
1. Model concrete data, assets, processing steps, checks, previews, and outputs as explicit nodes.
2. All processing or transformation nodes must use type="code". Never use type="semantic".
3. Use type="asset" for explicit inputs, outputs, files, generated artifacts, or reusable resources; use type="task" for review, debug, validation, preview, or manual checkpoints.
4. Every node must include explicit inputs and outputs arrays. Each port must be {id, name, type}.
5. Valid port types are: spline, point, polygon, bounds, graph, debug, asset, unknown.
6. Every link must include sourceHandle, targetHandle, and label.
7. sourceHandle must exactly match an output port id on the source node.
8. targetHandle must exactly match an input port id on the target node.
9. label should be the data name flowing through the edge.
10. Lay nodes out left-to-right as a dataflow graph: smaller x means upstream input, larger x means downstream output. Use y for parallel branches.
11. Node ids and port ids should be stable lowercase snake_case.
12. Keep the graph compact but complete: usually 5-12 nodes.
13. Match the user's language for display text: if the user writes Chinese, node title, purpose, port name, and edge label should be Chinese. Keep id, sourceHandle, targetHandle, and type as lowercase English snake_case.
14. Choose port types semantically. Use "graph" for structured graph/state, "asset" for files/resources, and "unknown" only when no better type applies.
15. Titles should name the structural role directly, such as "Input: Source Data", "Transform: Normalize Points", "Output: Subgraph", or equivalent localized labels.
"""


async def expand_plan(
    plan_text: str,
    existing_nodes: list[dict[str, Any]] | None = None,
    upstream_outputs: dict[str, str] | None = None,
    graph_kind: str = "workflow",
    expand_subgraphs: bool = False,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> dict[str, object]:
    """将规划文本展开为子节点+连线。返回 {"nodes": [...], "links": [...]}。"""
    if graph_kind == "structure":
        return await _expand_structure_plan(
            plan_text=plan_text,
            existing_nodes=existing_nodes or [],
            upstream_outputs=upstream_outputs or {},
            provider=provider,
            model=model,
            api_key=api_key,
        )
    if graph_kind != "workflow":
        raise ProviderError(f"unknown graph kind: {graph_kind}")

    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")
    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)

    try:
        user_goal = _build_expand_user_goal(
            plan_text=plan_text,
            existing_nodes=existing_nodes or [],
            upstream_outputs=upstream_outputs or {},
        )
        system_prompt = EXPAND_SYSTEM
        if expand_subgraphs:
            system_prompt = EXPAND_SYSTEM + "\n\n" + EXPAND_DEEP_SUBGRAPH_SECTION
        payload = await impl.emit_graph(
            system_prompt=system_prompt,
            user_goal=user_goal,
            tool_schema=EMIT_GRAPH_TOOL,
            model=chosen_model,
            api_key=api_key,
        )
        return _sanitize_workflow_payload(payload, expand_subgraphs=expand_subgraphs)
    except ProviderError as e:
        _log.warning("expand_plan provider=%s failed: %s", chosen, e)
        raise


async def _expand_structure_plan(
    *,
    plan_text: str,
    existing_nodes: list[dict[str, Any]],
    upstream_outputs: dict[str, str],
    provider: str | None,
    model: str | None,
    api_key: str | None,
) -> dict[str, object]:
    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")

    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)
    user_goal = _build_expand_user_goal(
        plan_text=plan_text,
        existing_nodes=existing_nodes,
        upstream_outputs=upstream_outputs,
    )

    try:
        payload = await impl.emit_graph(
            system_prompt=STRUCTURE_GRAPH_EXPAND_SYSTEM,
            user_goal=user_goal,
            tool_schema=EMIT_GRAPH_TOOL,
            model=chosen_model,
            api_key=api_key,
        )
    except ProviderError as e:
        _log.warning("expand_structure_plan provider=%s failed: %s", chosen, e)
        raise

    return _validate_structure_payload(payload)


def _validate_structure_payload(payload: dict[str, Any]) -> dict[str, object]:
    nodes = payload.get("nodes")
    links = payload.get("links")
    if not isinstance(nodes, list) or not isinstance(links, list):
        raise ProviderError("Subgraph payload must contain nodes and links arrays")
    if not nodes:
        raise ProviderError("Subgraph payload must contain at least one node")

    node_ids: set[str] = set()
    node_ports: dict[str, dict[str, set[str]]] = {}
    normalized_nodes: list[dict[str, Any]] = []

    for raw in nodes:
        if not isinstance(raw, dict):
            raise ProviderError("Subgraph node must be an object")
        node_id = str(raw.get("id") or "")
        if not node_id:
            raise ProviderError("Subgraph node is missing id")
        if node_id in node_ids:
            raise ProviderError(f"duplicate subgraph node id: {node_id}")
        node_ids.add(node_id)

        node_type = str(raw.get("type") or "")
        if node_type == "semantic":
            raise ProviderError(f"Subgraph node {node_id} used forbidden type semantic")
        if node_type not in {"asset", "code", "task"}:
            raise ProviderError(f"Subgraph node {node_id} must use asset, code, or task type")
        if "inputs" not in raw or "outputs" not in raw:
            raise ProviderError(f"Subgraph node {node_id} must include inputs and outputs arrays")
        if not isinstance(raw.get("inputs"), list) or not isinstance(raw.get("outputs"), list):
            raise ProviderError(f"Subgraph node {node_id} inputs and outputs must be arrays")
        for raw_port in [*raw["inputs"], *raw["outputs"]]:
            if not isinstance(raw_port, dict):
                raise ProviderError(f"Subgraph node {node_id} ports must be explicit objects")
            if not all(isinstance(raw_port.get(key), str) and raw_port.get(key) for key in ("id", "name", "type")):
                raise ProviderError(f"Subgraph node {node_id} ports must include id, name, and type")
            if raw_port["type"] not in {"spline", "point", "polygon", "bounds", "graph", "debug", "asset", "unknown"}:
                raise ProviderError(f"Subgraph node {node_id} has invalid port type: {raw_port['type']}")

        inputs = _normalize_ports(raw.get("inputs", []), "input")
        outputs = _normalize_ports(raw.get("outputs", []), "output")
        for port in [*inputs, *outputs]:
            if not port.get("id") or not port.get("name") or not port.get("type"):
                raise ProviderError(f"Subgraph node {node_id} has an invalid port")

        node_ports[node_id] = {
            "inputs": {port["id"] for port in inputs},
            "outputs": {port["id"] for port in outputs},
        }
        normalized_nodes.append({
            **raw,
            "type": node_type,
            "inputs": inputs,
            "outputs": outputs,
        })

    normalized_links: list[dict[str, Any]] = []
    for raw in links:
        if not isinstance(raw, dict):
            raise ProviderError("Subgraph link must be an object")
        source = str(raw.get("source") or "")
        target = str(raw.get("target") or "")
        source_handle = str(raw.get("sourceHandle") or "")
        target_handle = str(raw.get("targetHandle") or "")
        label = str(raw.get("label") or "")
        if source not in node_ids:
            raise ProviderError(f"Subgraph link references missing source node: {source}")
        if target not in node_ids:
            raise ProviderError(f"Subgraph link references missing target node: {target}")
        if not source_handle or not target_handle or not label:
            raise ProviderError(f"Subgraph link {source}->{target} must include sourceHandle, targetHandle, and label")
        if source_handle not in node_ports[source]["outputs"]:
            raise ProviderError(f"Subgraph link {source}->{target} sourceHandle does not match source outputs: {source_handle}")
        if target_handle not in node_ports[target]["inputs"]:
            raise ProviderError(f"Subgraph link {source}->{target} targetHandle does not match target inputs: {target_handle}")
        normalized_links.append({
            **raw,
            "source": source,
            "target": target,
            "sourceHandle": source_handle,
            "targetHandle": target_handle,
            "label": label,
        })

    return {"nodes": normalized_nodes, "links": normalized_links}



async def expand_modules(
    analysis_text: str,
    existing_nodes: list[dict[str, Any]] | None = None,
    upstream_outputs: dict[str, str] | None = None,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> dict[str, object]:
    """将代码分析文本展开为模块子节点+连线。返回 {"nodes": [...], "links": [...]}。"""
    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")
    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)

    try:
        user_goal = _build_expand_user_goal(
            plan_text=analysis_text,
            existing_nodes=existing_nodes or [],
            upstream_outputs=upstream_outputs or {},
        )
        payload = await impl.emit_graph(
            system_prompt=MODULE_GRAPH_SYSTEM,
            user_goal=user_goal,
            tool_schema=EMIT_GRAPH_TOOL,
            model=chosen_model,
            api_key=api_key,
        )
        return payload
    except ProviderError as e:
        _log.warning("expand_modules provider=%s failed: %s", chosen, e)
        raise


def _build_expand_user_goal(
    *,
    plan_text: str,
    existing_nodes: list[dict[str, Any]],
    upstream_outputs: dict[str, str],
) -> str:
    if not existing_nodes and not upstream_outputs:
        return plan_text

    parts = [
        "## 当前规划文本",
        plan_text,
        "",
        "## 已有图上下文",
        "这些节点已经存在于画布中。生成新节点时应避免重复创建同类上下文节点。",
    ]
    if existing_nodes:
        for node in existing_nodes[:12]:
            output = str(node.get("outputSummary") or "").strip()
            output_line = f"\n  output摘要: {output[:900]}" if output else ""
            parts.append(
                f"- id={node.get('id')} type={node.get('type')} title={node.get('title')} "
                f"hasOutput={node.get('hasOutput')} purpose={node.get('purpose') or ''}{output_line}"
            )
    else:
        parts.append("- 无")

    if upstream_outputs:
        parts.extend(["", "## Planning 上游输出摘要"])
        for key, text in list(upstream_outputs.items())[:8]:
            snippet = text.strip()[:1000]
            parts.append(f"### {key}\n{snippet}")

    parts.extend([
        "",
        "## 生成要求",
        "- 如果已有图上下文中存在 hasOutput=true 的 analysis，不要重复生成 analysis。",
        "- 如果新节点需要依赖已有上下文，请在新节点 purpose 中明确写出依赖哪个已有节点。",
        "- 只生成仍然缺失的执行节点、任务节点或代码节点。",
    ])
    return "\n".join(parts)


async def plan_graph(
    goal: str,
    provider: str | None = None,
    model: str | None = None,
    api_key: str | None = None,
) -> Graph:
    chosen = (provider or DEFAULT_PROVIDER).lower()
    if chosen not in _PROVIDERS:
        raise ProviderError(f"unknown provider: {chosen}")
    impl = _PROVIDERS[chosen]
    chosen_model = model or DEFAULT_MODELS.get(chosen)

    try:
        payload = await impl.emit_graph(
            system_prompt=PLANNER_SYSTEM,
            user_goal=goal,
            tool_schema=EMIT_GRAPH_TOOL,
            model=chosen_model,
            api_key=api_key,
        )
        return _to_internal_graph(payload)
    except ProviderError as e:
        # No API key OR provider refused → fall back to offline demo so the
        # UI flow stays demonstrable. We still log so users notice.
        _log.warning("provider=%s fell back to offline demo: %s", chosen, e)
        return _offline_demo(goal)


def _offline_demo(goal: str) -> Graph:
    """No API key → 返回硬编码示例，让 UI 流程可演示。"""
    nodes_raw = [
        {"id": "root", "type": "planning", "title": goal[:30] or "Project", "x": 0, "y": 0},
        {"id": "design", "type": "prompt", "title": "需求拆解", "x": 300, "y": -120},
        {"id": "data", "type": "memory", "title": "项目记忆", "x": 300, "y": 120},
        {"id": "impl", "type": "code", "title": "代码实现", "x": 600, "y": 0},
        {"id": "test", "type": "task", "title": "测试验证", "x": 900, "y": 0},
    ]
    links_raw = [
        {"source": "root", "target": "design"},
        {"source": "root", "target": "data"},
        {"source": "design", "target": "impl"},
        {"source": "data", "target": "impl"},
        {"source": "impl", "target": "test"},
    ]
    return _to_internal_graph({"nodes": nodes_raw, "links": links_raw})
