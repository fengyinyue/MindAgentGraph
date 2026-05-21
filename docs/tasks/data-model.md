# 共享数据模型扩展任务

## 目标

为 MVP 补齐节点输出、运行历史、资源引用预留和图元数据字段，同时保持旧 `.mag` 项目兼容。

## 子任务

- [x] `[modify]` 扩展 `shared/types.ts`
  - 验收：新增 `RunRecord`。
  - 验收：`NodeBase` 支持 `purpose`、`output`、`runHistory`、`resourceRefs`、`metadata`。
  - 验收：`Graph` 支持可选 `metadata`。

- [x] `[modify]` 扩展 `backend/app/schemas.py`
  - 验收：Python schema 与 TypeScript 类型字段一致。
  - 验收：新增字段均有默认值或 `Optional`。

- [x] `[modify]` 更新 JSON Schema
  - 验收：`shared/schema/node.schema.json` 接受新增字段。
  - 验收：旧图文件仍通过校验。

- [x] `[modify]` 更新保存/加载路径的空值处理
  - 验收：加载缺少新增字段的旧项目不报错。
  - 验收：保存后不会丢失现有字段。

## 测试要求

- TypeScript 类型检查通过：`npm --prefix frontend run lint`。
- 后端 schema import 正常。
- 手测加载现有 `.mag` 示例项目。
