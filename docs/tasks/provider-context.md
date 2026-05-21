# Provider、FileScope 与上下文可视化任务

## 目标

让用户在执行时能看清 Provider、模型、上下文模式、FileScope 和输出边界。

## 子任务

- [x] `[modify]` 收敛 Provider 枚举
  - 验收：前端 Provider 选项与后端 schema 一致。
  - 验收：未支持的 Provider 不会进入请求。

- [x] `[modify]` 优化 API Key 缺失反馈
  - 验收：用户能在 Settings 或执行错误中看到具体缺失项。
  - 验收：错误写入 BottomMonitor。

- [x] `[modify]` 在执行日志中记录 provider/model
  - 验收：单节点执行日志含 provider/model。
  - 验收：runHistory 可保存 provider/model。

- [x] `[modify]` NodeInspector 增强上下文模式说明
  - 验收：`inherit`、`explicit`、`isolated` 的差异可见。
  - 验收：不使用大段说明文字干扰主要编辑区。

- [x] `[modify]` FileScope 编辑和摘要一致化
  - 验收：allow/deny 可编辑。
  - 验收：执行前日志显示本次 FileScope 摘要。

- [x] `[modify]` Code 节点文件变更反馈
  - 验收：`files` SSE 事件进入日志。
  - 验收：变更列表关联 nodeId。

## 测试要求

- 手测 Anthropic 与 DeepSeek Provider 选择。
- 手测无 key、错误 key、Provider 超时或网络错误。
- 手测 Code 节点 FileScope 注入和文件变更事件。
