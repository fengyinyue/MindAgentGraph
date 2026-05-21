# MVP 任务进度

> 根据 `docs/proposal.md` 重新走流程生成。最后更新：2026-05-21。

## 任务文件

| 文件 | 模块 | 状态 | 依赖 |
|------|------|------|------|
| `docs/tasks/app-layout-refactor.md` | 4 区布局基础 | done | 无 |
| `docs/tasks/project-explorer.md` | 左侧 ProjectExplorer | done | app-layout-refactor |
| `docs/tasks/bottom-monitor.md` | 底部 BottomMonitor | done | app-layout-refactor |
| `docs/tasks/data-model.md` | 共享数据模型扩展 | done | 无 |
| `docs/tasks/dag-executor.md` | DAG 顺序执行 | done | data-model, bottom-monitor |
| `docs/tasks/provider-context.md` | Provider、FileScope、上下文可视化 | done | bottom-monitor, data-model |
| `docs/tasks/docs-traceability.md` | 需求追踪文档 | done | 全部设计文档 |

## 推荐执行顺序

1. `data-model.md`：先补齐兼容字段，降低后续模块返工。
2. `bottom-monitor.md`：先建立日志/错误/usage 容器。
3. `project-explorer.md`：补齐左侧节点树和文件范围可视化。
4. `provider-context.md`：把 Provider 错误、模型、FileScope、上下文摘要接入监控。
5. `dag-executor.md`：在已有单节点执行基础上做整图顺序执行。
6. 实施完成后复核 `requirements-traceability.md`：更新需求映射和验收状态。

## 整体进度

| 类别 | 状态 |
|------|------|
| 产品提案 | done |
| 现有代码库分析 | done |
| 概要设计 | done |
| 详细设计 | done |
| 任务拆解 | done |
| 实现 | done |
| 验证 | done |

## 跨模块约束

- 不实现完整多 Agent 运行时。
- 不实现强制文件沙箱。
- 不实现实时云同步、多用户协作、插件市场。
- 不把远期 SubGraph、SemanticIndex、MCPGateway 作为 MVP 阻塞项。
- 所有新增数据字段必须向后兼容旧 `.mag` 项目。

## 质量门槛

- 前端改动后运行 `npm --prefix frontend run lint`。
- 前端构建相关改动后运行 `npm --prefix frontend run build`。
- 后端改动后运行 `uv run pytest`；若环境不可用，记录原因。
- DAG 执行相关改动必须手测：成功执行、循环拒绝、Provider 错误、Code 节点跳过/显式执行策略。
