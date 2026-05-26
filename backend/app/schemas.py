from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

NodeType = Literal[
    "prompt", "planning", "workflow_graph", "structure_graph", "memory", "filescope",
    "project_scan", "code_analysis", "code", "api", "asset", "agent", "task", "semantic",
]
ContextMode = Literal["inherit", "explicit", "isolated"]
ProviderName = Literal["anthropic", "deepseek", "openai", "local-claude", "local-codex"]


class Position(BaseModel):
    x: float
    y: float


class FileScope(BaseModel):
    allow: list[str] = Field(default_factory=list)
    deny: list[str] = Field(default_factory=list)


class ToolPolicy(BaseModel):
    tools: list[str] = Field(default_factory=list)
    deny: list[str] = Field(default_factory=list)


class RunRecord(BaseModel):
    id: str
    startedAt: str
    finishedAt: Optional[str] = None
    status: Literal["running", "done", "error", "cancelled"]
    provider: Optional[str] = None
    model: Optional[str] = None
    inputTokens: Optional[int] = None
    outputTokens: Optional[int] = None
    error: Optional[str] = None
    changedFiles: list[str] = Field(default_factory=list)
    diff: Optional[str] = None
    diffTruncated: Optional[bool] = None
    diffWarnings: list[str] = Field(default_factory=list)


CodeRunEventType = Literal[
    "run_started",
    "prompt_prepared",
    "mcp_tool_called",
    "mcp_tool_result",
    "context_requested",
    "step_reported",
    "decision_reported",
    "confirmation_requested",
    "confirmation_answered",
    "stdout",
    "stderr",
    "diff_captured",
    "result_saved",
    "run_finished",
    "run_error",
]


class CodeRunEvent(BaseModel):
    id: str
    runId: str
    nodeId: str
    type: CodeRunEventType
    createdAt: str
    title: str
    message: Optional[str] = None
    path: Optional[str] = None
    command: Optional[str] = None
    toolName: Optional[str] = None
    status: Optional[Literal["pending", "running", "done", "error"]] = None
    payload: Optional[Any] = None


class Node(BaseModel):
    id: str
    type: NodeType
    title: str
    position: Position
    contextMode: ContextMode = "inherit"
    fileScope: FileScope = Field(default_factory=FileScope)
    toolPolicy: ToolPolicy = Field(default_factory=ToolPolicy)
    memoryRef: Optional[str] = None
    systemPrompt: Optional[str] = None
    parentId: Optional[str] = None
    data: dict[str, Any] = Field(default_factory=dict)
    summary: Optional[str] = None
    purpose: Optional[str] = None
    output: Optional[str] = None
    runHistory: list[RunRecord] = Field(default_factory=list)
    resourceRefs: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EdgeChannel(BaseModel):
    from_: str = Field(alias="from")
    to: str

    model_config = {"populate_by_name": True}


class Edge(BaseModel):
    id: str
    source: str
    sourceHandle: Optional[str] = None
    target: str
    targetHandle: Optional[str] = None
    label: Optional[str] = None
    channel: Optional[EdgeChannel] = None


class Graph(BaseModel):
    nodes: list[Node]
    links: list[Edge]
    metadata: dict[str, Any] = Field(default_factory=dict)


class PlanRequest(BaseModel):
    goal: str
    provider: Optional[ProviderName] = None
    model: Optional[str] = None


class RunNodeInput(BaseModel):
    id: Optional[str] = None
    title: str
    type: NodeType
    purpose: Optional[str] = ""
    contextMode: ContextMode = "inherit"
    memoryRef: Optional[str] = None
    systemPrompt: Optional[str] = None


class RunDagRequest(BaseModel):
    graph: Graph
    projectPath: Optional[str] = None
    provider: Optional[ProviderName] = None
    model: Optional[str] = None
    allowCode: bool = False
    rootNodeId: Optional[str] = None


class RunNodeRequest(BaseModel):
    node: RunNodeInput
    userPrompt: Optional[str] = None
    parentOutputs: Optional[dict[str, str]] = None
    projectPath: Optional[str] = None
    provider: Optional[ProviderName] = None
    model: Optional[str] = None


class CodeRunRequest(BaseModel):
    node: RunNodeInput
    projectDir: str
    projectPath: Optional[str] = None
    fileScopeAllow: Optional[list[str]] = None
    fileScopeDeny: Optional[list[str]] = None
    parentOutputs: Optional[dict[str, str]] = None
    userPrompt: Optional[str] = None
    model: Optional[str] = None
    runId: Optional[str] = None


class CodeAnalysisRequest(BaseModel):
    node: RunNodeInput
    projectDir: str
    projectPath: Optional[str] = None
    fileScopeAllow: Optional[list[str]] = None
    fileScopeDeny: Optional[list[str]] = None
    parentOutputs: Optional[dict[str, str]] = None
    userPrompt: Optional[str] = None
    model: Optional[str] = None
    runId: Optional[str] = None


class CodeCancelRequest(BaseModel):
    runId: str


class ExpandNodeSummary(BaseModel):
    id: str
    type: NodeType
    title: str
    purpose: Optional[str] = None
    hasOutput: bool = False
    outputSummary: Optional[str] = None


class ExpandPlanRequest(BaseModel):
    plan_text: str
    graph_kind: Literal["workflow", "structure"] = "workflow"
    existing_nodes: list[ExpandNodeSummary] = Field(default_factory=list)
    upstream_outputs: dict[str, str] = Field(default_factory=dict)
    provider: Optional[ProviderName] = None
    model: Optional[str] = None


class ExpandModulesRequest(BaseModel):
    analysis_text: str
    existing_nodes: list[ExpandNodeSummary] = Field(default_factory=list)
    upstream_outputs: dict[str, str] = Field(default_factory=dict)
    provider: Optional[ProviderName] = None
    model: Optional[str] = None


class ProjectScanRequest(BaseModel):
    node: RunNodeInput
    projectDir: str
    projectPath: Optional[str] = None
    fileScopeAllow: Optional[list[str]] = None
    fileScopeDeny: Optional[list[str]] = None
    maxFiles: int = 200
    maxBytesPerFile: int = 4000


class ProjectScanFile(BaseModel):
    path: str
    kind: str
    reason: Optional[str] = None


class ProjectScanCommand(BaseModel):
    name: str
    command: str


class ProjectScanResult(BaseModel):
    summary: str
    files: list[ProjectScanFile] = Field(default_factory=list)
    detectedStack: list[str] = Field(default_factory=list)
    suggestedFileScope: FileScope = Field(default_factory=FileScope)
    commands: list[ProjectScanCommand] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
