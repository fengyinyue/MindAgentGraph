from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

NodeType = Literal[
    "prompt", "planning", "memory", "filescope",
    "code", "api", "asset", "agent", "task", "semantic",
]
ContextMode = Literal["inherit", "explicit", "isolated"]
ProviderName = Literal["anthropic", "deepseek", "local-claude", "local-codex"]


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


class CodeCancelRequest(BaseModel):
    runId: str


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
