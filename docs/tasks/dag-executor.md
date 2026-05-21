# DAG 顺序执行任务

## 目标

实现 MVP 的整图按依赖顺序执行，并把进度、错误和输出接入 BottomMonitor。

## 子任务

- [x] `[new]` 创建 `backend/app/services/dag_executor.py`
  - 验收：实现拓扑排序。
  - 验收：循环图返回明确错误。

- [x] `[modify]` 在 `backend/app/schemas.py` 增加 `RunDagRequest`
  - 验收：包含 graph、projectPath、provider、model。
  - 验收：为 Code 节点批量执行预留显式开关，默认关闭。

- [x] `[modify]` 在 `backend/app/main.py` 增加 `POST /run/dag`
  - 验收：返回 SSE。
  - 验收：发送 `progress`、`log`、`error`、`done` 事件。

- [x] `[modify]` 前端 API 增加 `runDag`
  - 验收：Toolbar 可触发。
  - 验收：执行进度进入 `monitorStore`。

- [x] `[modify]` 将节点输出回写到 `graphStore`
  - 验收：执行完成后节点 `output` 更新。
  - 验收：下游节点收到上游 `parentOutputs`。

## MVP 策略

- 默认只自动执行 Prompt、Planning、Memory、File Scope、Agent、Task、Semantic 等非 Code 节点。
- Code 节点默认跳过并记录 `skipped`，除非用户显式允许批量代码执行。
- 首个错误默认停止后续节点；后续可扩展 continue-on-error。

## 测试要求

- 拓扑排序覆盖线性 DAG、分叉 DAG、多根 DAG、循环图。
- 手测成功 DAG、循环拒绝、Provider 错误、Code 节点跳过。
- 后端改动后运行 `uv run pytest` 或记录不可运行原因。
