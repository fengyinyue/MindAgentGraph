# Code Analysis 节点任务

## 目标

新增 `code_analysis` 节点，用 Claude Code 对已有项目做只读深度分析。该节点通常接在 Project Scan 后、Code 节点前，负责理解真实代码结构和实现入口。

## 子任务

- [x] `[modify]` 新增 `code_analysis` 节点类型
  - 修改 `shared/types.ts`、`shared/schema/node.schema.json`、`backend/app/schemas.py`。
  - 验收：Add Node 和 NodeInspector 中可选择 `code_analysis`。

- [x] `[new]` 实现 Claude Code 只读分析 runner
  - 新增 `backend/app/services/code_analysis_runner.py`。
  - 使用 Claude Code CLI 输出分析结果。
  - 工具限制为读取、搜索和列目录。
  - 验收：没有 `claude` 命令时返回 fallback 说明；有 Claude Code 时流式输出分析。

- [x] `[modify]` 新增 `/run/node/code-analysis` API
  - 新增 `CodeAnalysisRequest`。
  - 通过 SSE 返回 text/error/done。
  - 验收：前端可消费并写回节点 output。

- [x] `[modify]` 前端接入运行路径
  - 在 `backend.ts` 增加 `runNodeCodeAnalysis()`。
  - 在 `useRunNode.ts` 中对 `code_analysis` 分流。
  - 验收：未选择 Project Dir 时阻止运行，选择后可分析。

- [x] `[modify]` UI 展示
  - Canvas 右键菜单显示 `Analyze Code`。
  - NodeInspector 按钮显示 `Analyze Code`。
  - 验收：不显示 Code 节点的 `Generate Code` 动作。

- [x] `[modify]` Planning 展开规则
  - 已有项目复杂改动应生成 `Project Scan -> Code Analysis -> Code` 链路。
  - 验收：Planner prompt 明确包含该规则。

## 测试要求

- 前端构建：`npm.cmd run build`。
- 后端测试：`uv run --extra dev pytest`。
- 编译检查：`uv run python -m py_compile app/services/code_analysis_runner.py`。

## 非目标

- 不自动修改文件。
- 不替代 Code 节点。
- 不把 Claude Code Analysis 加入默认 DAG 批量执行。
- 不为每种项目硬编码完整专家规则。
