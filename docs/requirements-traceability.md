# 需求追踪矩阵 — MindAgentGraph MVP

> 来源：`docs/proposal.md`。最后更新：2026-05-22。

## 状态说明

| 状态 | 含义 |
|------|------|
| `done` | 当前代码已覆盖主要验收路径 |
| `partial` | 已有基础能力，但仍缺少 MVP 验收所需的一部分 |
| `planned` | 本轮 MVP 任务已规划，尚未实现 |
| `deferred` | 明确不属于 MVP |

## MVP 需求映射

| 需求 | 状态 | 实现位置 | 任务文件 | 验收方式 |
|------|------|----------|----------|----------|
| 可视化 DAG 节点画布 | `done` | `frontend/src/components/Canvas.tsx`, `frontend/src/store/graphStore.ts` | `docs/tasks/app-layout-refactor.md` | 手动创建/拖拽/连线节点 |
| 手动创建、编辑、拖拽、连接、删除节点 | `done` | Canvas、Toolbar、NodeInspector、graphStore | `docs/tasks/app-layout-refactor.md` | 手测节点 CRUD 和连线 |
| Planning 节点 Explain 生成规划文本 | `done` | `runner.py`, `NodeInspector`, `useRunNode.ts` | 已有能力 | Planning 节点可执行 Explain 并写入 output |
| Planning 节点基于规划文本 Generate Nodes | `done` | `/plan/expand`, `planner.py`, `useRunNode.ts`, Canvas/NodeInspector | 已有能力 | Planning 节点有 output 后可展开子节点图 |
| Project Scan 节点扫描已有工程 | `done` | `project_scanner.py`, `/project/scan`, `useRunNode.ts`, NodeInspector | `docs/tasks/project-scan-node.md` | 选择 projectDir 后只读扫描并写入 node.output |
| Code Analysis 节点只读分析代码 | `done` | `code_analysis_runner.py`, `/run/node/code-analysis`, `useRunNode.ts`, NodeInspector | `docs/tasks/code-analysis-node.md` | 选择 projectDir 后调用 Claude Code 只读分析并写入 node.output |
| 节点级 Prompt | `done` | `NodeInspector`, `runner.py`, `code_runner.py` | `docs/tasks/provider-context.md` | 执行节点时注入 systemPrompt |
| 节点级 Memory | `done` | `backend/app/services/memory.py`, `main.py` | `docs/tasks/provider-context.md` | inherit 写入/读取 `.mag/memory/` |
| 节点级 FileScope | `done` | `NodeInspector`, `ProjectExplorer`, `code_runner.py`, `useRunNode.ts` | `docs/tasks/provider-context.md` | Code 节点日志显示 FileScope，普通执行显示摘要 |
| 节点级 ContextMode | `done` | `runner.py`, `main.py`, NodeInspector | `docs/tasks/provider-context.md` | 对比 inherit/explicit/isolated 行为 |
| 单节点 Explain 执行 | `done` | `/run/node`, `useRunNode.ts` | `docs/tasks/bottom-monitor.md` | SSE text/error/done 正常 |
| Code 节点调用代码执行工具 | `done` | `/run/node/code`, `code_runner.py` | `docs/tasks/provider-context.md` | Code 节点输出与 files 事件正常 |
| Code 节点注入上下文与文件范围 | `done` | `code_runner.py`, `useRunNode.ts`, BottomMonitor | `docs/tasks/provider-context.md` | 日志可见注入摘要，文件变更可追踪 |
| DAG 按依赖顺序批量执行 | `done` | `backend/app/services/dag_executor.py`, `/run/dag`, `runDagStream` | `docs/tasks/dag-executor.md` | 线性/分叉/循环图手测 |
| 项目保存/加载 | `done` | `src-tauri/src/project.rs`, `frontend/src/api/project.ts`, `graphStore` | `docs/tasks/data-model.md` | 旧 `.mag` 可打开，新字段不丢失 |
| 基础 Provider 配置和模型切换 | `done` | `providerStore`, `keyStore`, `SettingsPanel`, `PlanInput`, Provider layer | `docs/tasks/provider-context.md` | Anthropic/DeepSeek 切换和错误反馈 |
| 右侧节点检查器 | `done` | `frontend/src/components/NodeInspector.tsx` | `docs/tasks/provider-context.md` | 编辑节点上下文字段 |
| 基础执行日志和错误反馈 | `done` | `monitorStore`, `BottomMonitor`, `useRunNode.ts` | `docs/tasks/bottom-monitor.md` | 成功/失败/取消均写入日志 |
| 用户能看到 AI 当前在哪个节点工作 | `done` | BottomMonitor, DAG progress, Node runHistory | `docs/tasks/bottom-monitor.md`, `docs/tasks/dag-executor.md` | 执行时显示 nodeId/title/status |
| 用户能看到 AI 使用了什么上下文 | `done` | NodeInspector, BottomMonitor | `docs/tasks/provider-context.md` | 执行前日志显示 contextMode/FileScope/memoryRef |
| 用户能看到 AI 产生了什么输出 | `done` | NodeInspector output/codeOutput, NodeBase.output | `docs/tasks/data-model.md` | 输出写入节点 `output` 并可保存 |
| 左侧节点树/项目结构 | `done` | `LeftPanel`, `ProjectExplorer` | `docs/tasks/project-explorer.md` | 节点树与选中联动 |
| 底部日志/错误/Token/进度面板 | `done` | `BottomPanel`, `BottomMonitor` | `docs/tasks/bottom-monitor.md` | 日志、错误、Token、进度 Tab 可用 |
| `.mag` Git 友好存储 | `done` | Tauri Project IO, Memory service, compatible optional fields | `docs/tasks/data-model.md` | 保存后 JSON/Markdown 稳定可 diff |

## 非 MVP / 延后需求

| 需求 | 状态 | 原因 |
|------|------|------|
| 完整多 Agent 运行时 | `deferred` | 提案明确不属于 MVP，当前只保留 Agent 类型节点展示 |
| Agent 通信面板真实消息流 | `deferred` | 需要 AgentComm/AgentRuntime，当前底部面板保留执行可观测能力 |
| 强制文件沙箱 | `deferred` | MVP 中 FileScope 作为提示约束，不做硬隔离 |
| 多用户协作 | `deferred` | MVP 本地桌面优先 |
| 实时云同步 | `deferred` | MVP 使用本地 `.mag` |
| 自动生成 Unreal Blueprint / PCG / Behavior Tree | `deferred` | 第一阶段只做规划和代码辅助 |
| 完整多模态资源管理 | `deferred` | MVP 只预留 `resourceRefs` |
| 向量数据库级长期记忆 | `deferred` | MVP 使用 Markdown Memory |
| 插件市场或复杂权限系统 | `deferred` | 超出当前验证闭环 |
| SubGraph、分组、注释、节点模板 | `deferred` | 后续高级节点能力 |
| MCP 工具网关 | `deferred` | 后续 Agent/工具生态能力 |

## 当前优先级

1. Project Scan / Repo Context 节点：`docs/tasks/project-scan-node.md`
2. Code Analysis 节点：`docs/tasks/code-analysis-node.md`
3. 数据模型扩展：`docs/tasks/data-model.md`
4. 底部监视器：`docs/tasks/bottom-monitor.md`
5. 左侧项目浏览器：`docs/tasks/project-explorer.md`
6. Provider/FileScope/上下文可视化：`docs/tasks/provider-context.md`
7. DAG 顺序执行：`docs/tasks/dag-executor.md`

## 残余风险

- 现有文档曾把部分能力标为已完成，实际代码中仍可能只是占位或局部实现。
- Code 节点批量执行有修改工程文件风险，MVP 默认应跳过或要求用户显式允许。
- Token usage 取决于 Provider 返回能力，不能作为阻断执行的硬依赖。
- `.mag` 旧项目兼容需要在数据模型扩展后专门手测。
- Project Scan 的扫描摘要需要控制长度，否则会把过多项目上下文塞入下游节点。
- Code Analysis 的只读约束依赖 Claude Code CLI 工具参数和 prompt 共同保证，仍应把真正改文件留给 Code 节点。
