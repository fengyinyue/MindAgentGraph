# 现有代码库分析 — MindAgentGraph

> 基于 `docs/proposal.md` 重新走流程时补充的当前实现基线。最后更新：2026-05-21。

## 1. 项目概览

MindAgentGraph 当前是一个桌面优先的节点式 AI 规划工具：

- 桌面壳：Tauri 2.x，Rust 主进程负责 sidecar 管理与本地项目 IO。
- 前端：React 18、TypeScript、Vite、Tailwind CSS、@xyflow/react、Zustand。
- 后端：Python 3.11+、FastAPI、SSE、Anthropic/OpenAI SDK、Pydantic。
- 存储：`.mag/` 项目目录，图结构使用 JSON，记忆使用 Markdown。
- 开发入口：根目录 `npm run dev`，前端 `npm run lint` / `npm run build`，后端通过 `uv`/FastAPI sidecar。

## 2. 目录与职责

| 路径 | 职责 |
|------|------|
| `frontend/src/` | React 应用、画布、检查器、工具栏、Provider/Key/Panel/Graph 状态 |
| `backend/app/` | FastAPI 路由、规划、节点执行、代码执行、记忆读写、Provider 适配 |
| `shared/` | TypeScript 类型与 JSON Schema |
| `src-tauri/` | Tauri 主进程、sidecar 启动、项目文件读写 |
| `docs/` | 产品、设计、任务、执行提示文档 |
| `test-project/` | 本地测试项目样例，未纳入本次设计边界 |

## 3. 已有能力

前端已有：

- React Flow 画布与 `graphStore`，支持节点、连线、选中、更新、删除。
- `NodeInspector`，用于编辑节点上下文相关字段。
- `PlanInput`，用于输入目标并调用规划接口生成图。
- `Toolbar`，用于项目、面板、设置等操作入口。
- `LeftPanel` 与 `BottomPanel` 外壳，占位展示节点树/日志/通信/Token 区域。
- `panelStore`，保存左右/底部面板开关和尺寸状态。

后端已有：

- `/health` 健康检查。
- `/plan`：调用 Provider 生成 DAG 图。
- `/run/node`：单节点文本执行，SSE 返回文本事件。
- `/run/node/code`：调用 Claude Code CLI 执行 Code 节点，支持文件变更事件。
- `/run/node/code/cancel`：取消代码执行。
- `memory.py`：`.mag/memory/` 读写与路径安全处理。
- Provider 抽象：Anthropic 与 DeepSeek/OpenAI-compatible Provider。

## 4. 当前缺口

与产品提案中的 MVP 对比，当前主要缺口是：

- 左侧面板仍是占位，缺少节点树、文件范围视图、Agent 列表。
- 底部面板仍是占位，缺少执行日志、错误流、Token 使用统计。
- `shared/types.ts` 与 `backend/app/schemas.py` 的 `Graph` 只包含 `nodes`/`links`，未预留资源引用、运行历史、扩展元数据。
- 单节点执行已有，但 DAG 顺序执行、批量执行进度、失败策略需要统一。
- Provider 配置已有基础能力，但前后端 Provider 枚举、模型切换、错误反馈需要收敛。
- FileScope 在 Code 节点执行中已注入，但 UI 和普通节点执行中的语义展示仍不完整。
- 缺少面向 MVP 的需求追踪与任务进度文档。

## 5. 约束与约定

- 优先复用现有 React Flow、Zustand、FastAPI、SSE、`.mag` 存储和 Provider 协议。
- 新字段必须向后兼容已有 `.mag` 文件，默认值使用空数组、空对象或 `None`。
- MVP 只把 FileScope 作为提示约束和代码工具输入，不实现强制文件沙箱。
- 多 Agent 运行时、语义索引、完整资源管理、MCP 网关属于后续阶段，不进入当前 MVP 主线。
- 文档和任务拆解应围绕 Phase 1 的可交付闭环，而不是展开远期生态能力。

## 6. 建议集成方向

当前最合理的集成路线是收尾 Phase 1：

1. 补齐左侧 ProjectExplorer，使节点结构、文件范围和 Agent 占位列表可见。
2. 补齐底部 BottomMonitor，使执行日志、错误和 Token 信息可追踪。
3. 扩展基础数据模型，保留 `runHistory`、`resourceRefs`、`metadata` 等 MVP 需要的可选字段。
4. 实现前后端一致的 DAG 执行进度事件，先做顺序执行，后续再升级并行/Agent 调度。
5. 更新任务与执行提示，把实现范围限定在“节点级上下文管理 + AI 规划执行”的 MVP 闭环。
