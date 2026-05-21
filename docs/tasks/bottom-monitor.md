# BottomMonitor 底部监视器任务

## 目标

把底部占位面板升级为执行可观测中心，承载日志、错误、Token 使用和 DAG 执行进度。

## 子任务

- [x] `[new]` 创建 `frontend/src/store/monitorStore.ts`
  - 验收：支持 logs、errors、tokenUsages、dagProgress。
  - 验收：提供 add/clear/update 类 action。

- [x] `[new]` 创建 `frontend/src/components/BottomMonitor.tsx`
  - 验收：包含 Logs、Errors、Tokens、Progress 四个 Tab。
  - 验收：每个 Tab 有空态和清空操作。

- [x] `[modify]` 将 `BottomPanel.tsx` 改为承载 `BottomMonitor`
  - 验收：保留折叠/展开行为。
  - 验收：Tab 状态不会因折叠丢失。

- [x] `[modify]` 在 `frontend/src/api/backend.ts` 解析新增 SSE 事件
  - 验收：兼容现有 `text`、`files`、`error`、`done`。
  - 验收：新增 `log`、`usage`、`progress` 事件不会破坏旧后端。

- [x] `[modify]` 在 `useRunNode.ts` 接入监控事件
  - 验收：单节点执行开始、成功、失败均写入日志。
  - 验收：错误能关联 nodeId/nodeTitle。

## 测试要求

- store action 单元测试或轻量组件测试。
- 手测单节点执行成功和错误场景。
- 运行 `npm --prefix frontend run lint` 与 `npm --prefix frontend run build`。
