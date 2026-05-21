# 实施提示 — MindAgentGraph MVP 收尾

## 目标

基于 `docs/proposal.md` 完成 Phase 1 MVP 收尾：补齐左侧项目浏览器、底部执行监视器、兼容数据模型、DAG 顺序执行、Provider/FileScope/上下文可视化，并更新需求追踪。

成功标准：

- 用户可以输入目标生成 DAG。
- 用户可以从左侧理解节点结构和文件范围。
- 用户可以执行单节点并看到日志、错误、Token/模型信息。
- 用户可以按依赖顺序执行整图，看到每个节点进度。
- 节点输出、运行历史和上下文边界能回写到图或监控状态。
- 旧 `.mag` 项目仍可打开。

## 先读文件

1. `docs/proposal.md`
2. `docs/existing-codebase.md`
3. `docs/high-level-design.md`
4. `docs/detailed-design.md`
5. `docs/tasks/progress.md`
6. 对应任务文件：`docs/tasks/*.md`

## 主 Agent 职责

- 按 `docs/tasks/progress.md` 的推荐顺序推进。
- 每完成一个子任务，更新对应任务文件的 checkbox。
- 不回退用户未要求回退的改动。
- 保持改动范围聚焦在当前任务文件指定模块。
- 集成前审查共享类型、前端 store、后端 schema 是否一致。
- 每批改动后运行相关质量门槛。

## Worker 职责

在明确允许并行协作时，可把以下任务拆给不同 worker：

- Worker A：`data-model.md`，负责 `shared/` 与 `backend/app/schemas.py`。
- Worker B：`bottom-monitor.md`，负责 `monitorStore`、`BottomMonitor`、SSE 解析。
- Worker C：`project-explorer.md`，负责 `ProjectExplorer` 与 `LeftPanel`。
- Worker D：`dag-executor.md`，负责后端 DAG executor 与前端 `runDag` 接入。

所有 worker 必须：

- 说明改动文件。
- 不覆盖他人改动。
- 遵循现有 TypeScript、React、FastAPI、Zustand 风格。
- 添加或更新必要测试。
- 报告验证命令结果。

## 实施顺序

1. 数据模型扩展。
2. BottomMonitor 与 monitorStore。
3. ProjectExplorer。
4. Provider、FileScope、上下文日志收敛。
5. DAG 顺序执行。
6. 需求追踪文档。

## 质量门槛

前端改动后：

```powershell
npm --prefix frontend run lint
npm --prefix frontend run build
```

后端改动后：

```powershell
uv run pytest
```

如果本地缺少 uv、依赖或测试环境，记录具体失败原因。不要把未运行的检查写成已通过。

## 约束

- MVP 不实现完整多 Agent 运行时。
- MVP 不实现强制文件沙箱。
- MVP 不实现 SubGraph、SemanticIndex、MCPGateway 或完整资源管理器。
- Code 节点在 DAG 批量执行中默认跳过，除非用户显式允许。
- 新增字段必须向后兼容旧项目。
- Provider usage 不可用时不阻断执行。
