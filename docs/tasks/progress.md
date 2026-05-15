# 总体进度跟踪

> 最后更新：2026-05-15

## 整体进度

| 阶段 | 模块 | 状态 | 完成日期 |
|------|------|------|----------|
| Phase 1 | M1: App 布局重构 | ✅ 已完成 | 2026-05-15 |
| Phase 1 | M2: ProjectExplorer 左侧面板 | ⬜ 待开始 | - |
| Phase 1 | M3: BottomMonitor 底部面板 | ⬜ 待开始 | - |
| Phase 2 | M4: 数据模型扩展 | ⬜ 待开始 | - |
| Phase 2 | M5: AgentRuntime 运行时 | ⬜ 待开始 | - |
| Phase 2 | M6: AgentComm 通信协议 | ⬜ 待开始 | - |
| Phase 2 | M7: Supervisor 调度器 | ⬜ 待开始 | - |
| Phase 3 | M8: SubGraph 子图系统 | ⬜ 待开始 | - |
| Phase 3 | M9: 节点分组与注释 | ⬜ 待开始 | - |
| Phase 4 | M10: SemanticIndex 语义索引 | ⬜ 待开始 | - |
| Phase 4 | M11: TaskQueue 任务队列 | ⬜ 待开始 | - |
| Phase 4 | M12: ResourceManager 资源管理 | ⬜ 待开始 | - |
| Phase 4 | M13: 新 Provider 适配器 | ⬜ 待开始 | - |
| Phase 5 | M14: MCPGateway MCP 网关 | ⬜ 待开始 | - |
| - | M15: API 路由汇总 | ⬜ 待开始 | - |

## 模块依赖关系

```
M1 (布局) ─────────────────────────────────────────────┐
                                                        │
M2 (左面板) ← M1 ──────────────────────────────────────┤
M3 (底面板) ← M1 ──────────────────────────────────────┤
                                                        │
M4 (类型扩展) ← 无依赖 ─────────────────────────────────┤
                                                        │
M5 (AgentRuntime) ← runner.py, Provider ────────────────┤
M6 (AgentComm) ← 无依赖 ────────────────────────────────┤
M7 (Supervisor) ← M5, M6, M11 ─────────────────────────┤
                                                        │
M8 (SubGraph) ← M4, graphStore ────────────────────────┤
M9 (分组注释) ← Canvas.tsx ─────────────────────────────┤
                                                        │
M10 (SemanticIndex) ← memory.py ────────────────────────┤
M11 (TaskQueue) ← 无依赖 ───────────────────────────────┤
M12 (ResourceManager) ← M4 ────────────────────────────┤
M13 (Providers) ← base.py ─────────────────────────────┤
M14 (MCPGateway) ← M5 ─────────────────────────────────┤
```

## 风险与注意事项

- M1 布局重构后，需确保 Canvas 组件的 ReactFlow 渲染不受面板尺寸变化影响（`react-resizable-panels` 的 `resize` 事件需触发 ReactFlow 的 `fitView` 或 `resize`）
- M2/M3 内容可后续填充，当前只需占位外壳
- `react-resizable-panels` 新增依赖，需确认与 React 18 兼容
