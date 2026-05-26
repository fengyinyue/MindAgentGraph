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
    "deepseek": os.environ.get("MAG_MODEL_DEEPSEEK", "deepseek-chat"),
    "openai": os.environ.get("MAG_MODEL_OPENAI", "gpt-4.1"),
    "local-claude": os.environ.get("MAG_MODEL_LOCAL_CLAUDE", "sonnet"),
    "local-codex": os.environ.get("MAG_MODEL_LOCAL_CODEX", ""),
}

PLANNER_SYSTEM = """你是 MindAgentGraph 的项目规划助手。

你的任务：把用户的一句话目标，拆解成一个由"思维节点"组成的 DAG (有向无环图)。

节点类型说明：
- workflow_graph: 高层工作流规划/总控节点（通常是根节点）
- structure_graph: 结构化数据流/依赖图入口节点
- prompt: 与 AI 对话生成内容的节点
- code: 代码实现节点
- project_scan: 只读扫描已有工程结构，输出技术栈、关键文件、改动边界和风险
- code_analysis: 使用 Claude Code 只读分析已有代码，输出架构理解、实现入口、风险和建议改动范围
- asset: 资源/素材节点
- task: 待办任务节点
- memory: 记忆/上下文节点
- filescope: 文件作用域定义

设计原则：
1. 5-12 个节点，覆盖目标的关键模块
2. 每个节点应有清晰的单一职责
3. 用 links 表达数据依赖（A 的输出是 B 的输入）
4. 节点位置 (position) 要分散。layout 从上到下：同级节点 x 间距 ≥ 200（水平均匀散开），父子节点 y 间距 ≥ 300（向下延伸）
5. 根节点放在 (0,0)，下游节点向下展开，同层兄弟节点水平排列

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
3. 节点位置 (position) 要分散。同级节点 x 间距 ≥ 200，父子节点 y 间距 ≥ 300
4. 根模块放在 (0,0)，下游模块向下展开，同层兄弟节点水平排列
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
                "items": {
                    "type": "object",
                    "required": ["id", "type", "title", "x", "y"],
                    "properties": {
                        "id": {"type": "string"},
                        "type": {
                            "type": "string",
                            "enum": [
                                "prompt", "workflow_graph", "structure_graph", "memory", "filescope",
                                "project_scan", "code_analysis", "code", "api", "asset", "agent", "task",
                            ],
                        },
                        "title": {"type": "string"},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "purpose": {"type": "string", "description": "What this node does"},
                        "inputs": {"type": "array", "items": {"$ref": "#/$defs/dataPort"}},
                        "outputs": {"type": "array", "items": {"$ref": "#/$defs/dataPort"}},
                    },
                },
            },
            "links": {
                "type": "array",
                "items": {
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
            },
        },
        "$defs": {
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
    return "workflow_graph" if str(node_type) == "planning" else str(node_type)


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


def _sanitize_workflow_payload(payload: dict[str, Any]) -> dict[str, object]:
    """Keep workflow expansion as a high-level DAG, not a port graph."""
    nodes: list[dict[str, Any]] = []
    for raw in payload.get("nodes", []):
        if not isinstance(raw, dict):
            continue
        node = dict(raw)
        node["type"] = _normalize_node_type(node.get("type"))
        node["inputs"] = []
        node["outputs"] = []
        nodes.append(node)

    links: list[dict[str, Any]] = []
    for raw in payload.get("links", []):
        if not isinstance(raw, dict):
            continue
        link = {
            "source": raw.get("source"),
            "target": raw.get("target"),
        }
        if raw.get("label") is not None:
            link["label"] = raw.get("label")
        links.append(link)

    return {"nodes": nodes, "links": links}


EXPAND_SYSTEM = """你是 MindAgentGraph 的项目规划助手。

你的任务：根据已有的高层规划文本，将其拆解成一组节点组成的 DAG (有向无环图)。

节点类型选择规则：
- 小/中型项目（单一系统，如"番茄钟"、"Markdown编辑器"）：直接生成实现节点（code、task、prompt），不要创建 workflow_graph 子节点
- 大型项目（覆盖多个独立子系统，如"电商平台"、"游戏引擎"）：可以为每个子系统创建一个 workflow_graph 节点（后续可各自 Explain + Generate Nodes 展开），子系统之间直接生成实现节点
- 如果规划文本包含"当前项目"、"已有项目"、"现有代码"、"修复"、"改造"、"接入"、"重构"等已有工程开发意图，优先生成一个 project_scan 节点
- project_scan 节点必须位于后续 code_analysis/prompt/task/code 节点上游，用 links 表达依赖
- 对需要理解真实代码结构的已有项目改动，在 project_scan 后生成 code_analysis 节点，再让 code 节点依赖 code_analysis
- 当某个阶段的核心工作是设计结构、数据流、模块依赖、资源/资产管线、生成规则图、Blueprint/节点图、PCG 或可视化流程时，优先生成一个 structure_graph 节点作为结构设计入口，而不是直接把该结构拆成多个 code/task 节点
- structure_graph 节点应位于后续 code/task/prompt 节点上游；后续实现节点的 purpose 中要明确它依赖 Structure Graph 的结构输出
- 不要把 structure_graph 用作普通任务清单；只有当下游需要端口化结构、数据流或依赖关系时才使用它
- 即使生成了 structure_graph，仍应在 workflow_graph 外层生成必要的执行节点，例如 project_scan/code_analysis/code/task/test/review；不要只返回一个 structure_graph 节点
- workflow_graph 外层不要重复拆解 structure_graph 内部的数据流节点；内部输入/转换/输出节点应留给 Structure Graph 自己展开
- 当 workflow_graph 中已有 structure_graph 时，不要把 Validate/Material/LOD/Collider/Prefab 等内部处理阶段逐个镜像成外层 code 节点；外层 code 节点应是粗粒度工作包，例如"实现管线运行框架"、"根据 Structure Graph 实现处理器集合"、"集成导出与报告"、"验证与交付"
- workflow_graph 返回的节点不要填写 inputs/outputs 端口，links 也不要填写 sourceHandle/targetHandle；端口化数据流只属于 Structure Graph 内部
- 如果输入中提供了"已有图上下文"，且其中已经存在可复用的 project_scan 或 code_analysis 节点，优先复用这些已有上下文，不要重复生成同类扫描/分析节点
- 工具返回的 links 只能连接本次返回的 nodes；如果需要依赖已有节点，请在新节点 purpose 中明确写"依赖已有节点：<title>"
- 全新项目、纯文案/创作任务、独立代码片段，不要生成 project_scan 节点

节点类型说明：
- workflow_graph: 仅用于大型项目中独立子系统的规划入口
- structure_graph: 用于生成端口化的数据流/结构图入口
- project_scan: 只读扫描已有工程结构，输出技术栈、关键文件、改动边界和风险
- code_analysis: 使用 Claude Code 只读分析已有代码，输出架构理解、实现入口、风险和建议改动范围
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
4. 节点位置 (position) 分散。同级节点 x 间距 ≥ 200，父子节点 y 间距 ≥ 250
5. 根节点放在 (0,0)，下游节点向下展开，同层兄弟节点水平排列
6. 节点的 purpose 字段要具体

必须用 emit_graph 工具返回结构化结果，不要写自由文本。"""


STRUCTURE_GRAPH_EXPAND_SYSTEM = """You are a structure graph architect for MindAgentGraph.

Your task is to convert the user's requirement into a structured dataflow or dependency graph.

Use emit_graph and return only structured nodes and links.

Structure graph rules:
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
15. Titles should name the structural role directly, such as "Input: Source Data", "Transform: Normalize Points", "Output: Structure Graph", or equivalent localized labels.
"""


async def expand_plan(
    plan_text: str,
    existing_nodes: list[dict[str, Any]] | None = None,
    upstream_outputs: dict[str, str] | None = None,
    graph_kind: str = "workflow",
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
        payload = await impl.emit_graph(
            system_prompt=EXPAND_SYSTEM,
            user_goal=user_goal,
            tool_schema=EMIT_GRAPH_TOOL,
            model=chosen_model,
            api_key=api_key,
        )
        return _sanitize_workflow_payload(payload)
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
        raise ProviderError("Structure graph payload must contain nodes and links arrays")
    if not nodes:
        raise ProviderError("Structure graph payload must contain at least one node")

    node_ids: set[str] = set()
    node_ports: dict[str, dict[str, set[str]]] = {}
    normalized_nodes: list[dict[str, Any]] = []

    for raw in nodes:
        if not isinstance(raw, dict):
            raise ProviderError("Structure graph node must be an object")
        node_id = str(raw.get("id") or "")
        if not node_id:
            raise ProviderError("Structure graph node is missing id")
        if node_id in node_ids:
            raise ProviderError(f"duplicate structure graph node id: {node_id}")
        node_ids.add(node_id)

        node_type = str(raw.get("type") or "")
        if node_type == "semantic":
            raise ProviderError(f"Structure graph node {node_id} used forbidden type semantic")
        if node_type not in {"asset", "code", "task"}:
            raise ProviderError(f"Structure graph node {node_id} must use asset, code, or task type")
        if "inputs" not in raw or "outputs" not in raw:
            raise ProviderError(f"Structure graph node {node_id} must include inputs and outputs arrays")
        if not isinstance(raw.get("inputs"), list) or not isinstance(raw.get("outputs"), list):
            raise ProviderError(f"Structure graph node {node_id} inputs and outputs must be arrays")
        for raw_port in [*raw["inputs"], *raw["outputs"]]:
            if not isinstance(raw_port, dict):
                raise ProviderError(f"Structure graph node {node_id} ports must be explicit objects")
            if not all(isinstance(raw_port.get(key), str) and raw_port.get(key) for key in ("id", "name", "type")):
                raise ProviderError(f"Structure graph node {node_id} ports must include id, name, and type")
            if raw_port["type"] not in {"spline", "point", "polygon", "bounds", "graph", "debug", "asset", "unknown"}:
                raise ProviderError(f"Structure graph node {node_id} has invalid port type: {raw_port['type']}")

        inputs = _normalize_ports(raw.get("inputs", []), "input")
        outputs = _normalize_ports(raw.get("outputs", []), "output")
        for port in [*inputs, *outputs]:
            if not port.get("id") or not port.get("name") or not port.get("type"):
                raise ProviderError(f"Structure graph node {node_id} has an invalid port")

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
            raise ProviderError("Structure graph link must be an object")
        source = str(raw.get("source") or "")
        target = str(raw.get("target") or "")
        source_handle = str(raw.get("sourceHandle") or "")
        target_handle = str(raw.get("targetHandle") or "")
        label = str(raw.get("label") or "")
        if source not in node_ids:
            raise ProviderError(f"Structure graph link references missing source node: {source}")
        if target not in node_ids:
            raise ProviderError(f"Structure graph link references missing target node: {target}")
        if not source_handle or not target_handle or not label:
            raise ProviderError(f"Structure graph link {source}->{target} must include sourceHandle, targetHandle, and label")
        if source_handle not in node_ports[source]["outputs"]:
            raise ProviderError(f"Structure graph link {source}->{target} sourceHandle does not match source outputs: {source_handle}")
        if target_handle not in node_ports[target]["inputs"]:
            raise ProviderError(f"Structure graph link {source}->{target} targetHandle does not match target inputs: {target_handle}")
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
        "- 如果已有图上下文中存在 hasOutput=true 的 project_scan，不要重复生成 project_scan。",
        "- 如果已有图上下文中存在 hasOutput=true 的 code_analysis，不要重复生成 code_analysis。",
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
        {"id": "root", "type": "workflow_graph", "title": goal[:30] or "Project", "x": 0, "y": 0},
        {"id": "design", "type": "prompt", "title": "需求拆解", "x": -220, "y": 300},
        {"id": "data", "type": "memory", "title": "项目记忆", "x": 0, "y": 300},
        {"id": "impl", "type": "code", "title": "代码实现", "x": 220, "y": 300},
        {"id": "test", "type": "task", "title": "测试验证", "x": 0, "y": 600},
    ]
    links_raw = [
        {"source": "root", "target": "design"},
        {"source": "root", "target": "data"},
        {"source": "design", "target": "impl"},
        {"source": "data", "target": "impl"},
        {"source": "impl", "target": "test"},
    ]
    return _to_internal_graph({"nodes": nodes_raw, "links": links_raw})
