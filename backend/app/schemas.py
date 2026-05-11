from typing import Any, Literal, Optional
from pydantic import BaseModel, Field

NodeType = Literal[
    "prompt", "planning", "memory", "filescope",
    "code", "api", "asset", "agent", "task", "semantic",
]
ContextMode = Literal["inherit", "explicit", "isolated"]


class Position(BaseModel):
    x: float
    y: float


class FileScope(BaseModel):
    allow: list[str] = Field(default_factory=list)
    deny: list[str] = Field(default_factory=list)


class ToolPolicy(BaseModel):
    tools: list[str] = Field(default_factory=list)
    deny: list[str] = Field(default_factory=list)


class Node(BaseModel):
    id: str
    type: NodeType
    title: str
    position: Position
    contextMode: ContextMode = "explicit"
    fileScope: FileScope = Field(default_factory=FileScope)
    toolPolicy: ToolPolicy = Field(default_factory=ToolPolicy)
    memoryRef: Optional[str] = None
    data: dict[str, Any] = Field(default_factory=dict)
    summary: Optional[str] = None


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


class PlanRequest(BaseModel):
    goal: str
    provider: Optional[Literal["anthropic", "deepseek"]] = None
    model: Optional[str] = None


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
