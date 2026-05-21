# 需求追踪文档任务

## 目标

更新 `docs/requirements-traceability.md`，把 `docs/proposal.md` 的 MVP 需求映射到实现位置、任务文件和验收方式。

## 子任务

- [x] `[modify]` 重建 MVP 需求表
  - 验收：覆盖提案第 5、6、7、8、11 节中的 MVP 条目。

- [x] `[modify]` 标注当前状态
  - 验收：状态只使用 `done`、`partial`、`planned`、`deferred`。
  - 验收：已明确排除的非目标标为 `deferred`。

- [x] `[modify]` 关联代码位置
  - 验收：每个 MVP 需求至少关联一个模块或说明尚未实现。

- [x] `[modify]` 关联任务文件
  - 验收：每个 planned/partial 需求关联 `docs/tasks/*.md`。

- [x] `[modify]` 添加验收方式
  - 验收：每个 MVP 需求有人工验收或自动检查方式。

## 测试要求

- 文档链接路径有效。
- 表格可读，不堆叠远期功能。
