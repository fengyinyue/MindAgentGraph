# MAG MCP Roadmap

## 1. 背景

MindAgentGraph 当前已经具备较清晰的节点规划能力：用户可以把复杂目标拆成 DAG 节点，并通过 `project_scan`、`code_analysis`、`code` 等节点组织上下文与执行顺序。

但在编程执行体验上，当前 `code` 节点主要通过后端启动 Claude Code CLI 完成任务。这个方式能产出代码和 diff，但 MAG 对执行过程的参与度仍然较低：

- Claude Code 主要接收一次性 prompt，不会主动从 MAG 拉取节点上下文。
- `fileScope`、上游输出、memory 等 MAG 信息主要被拼进 prompt，难以复用和结构化管理。
- Code 节点输出更像一段最终日志，而不是由 MAG 统一记录的结构化执行过程。
- MAG 当前更像“启动器”，而不是 Claude Code 的上下文与协作工具层。

因此，下一阶段不建议立刻完整自研 code agent，而是优先将 MAG 做成一个 MCP Server，让 Claude Code 能够调用 MAG 提供的上下文、记录和确认能力。

核心方向：

> MAG 负责节点上下文、fileScope、memory、执行记录、确认流与结果归档；Claude Code 负责实际 coding agent 能力，并通过 MCP 与 MAG 协作。

## 2. 目标

### 2.1 产品目标

- 让 Claude Code 可以主动获取 MAG 当前节点、上游节点、fileScope 和 memory。
- 让 MAG 的节点图成为 Claude Code 的结构化任务上下文，而不是只生成一段长 prompt。
- 让 Claude Code 可以通过 MCP 主动向 MAG 报告步骤、决策、结果和待确认事项。
- 让 Code 节点逐步从“黑盒输出”变成“由 MAG 记录的执行会话”。
- 为未来 MAG Native Code Agent 预留统一的 run/context/result 模型。

### 2.2 非目标

第一阶段不做完整自研 code agent。

第一阶段不替代 Claude Code 的文件编辑、命令执行和多轮 agent loop。

第一阶段不做额外的底层执行监听机制，重点只放在 MCP Server 暴露 MAG 能力。

第一阶段不追求强制拦截 Claude Code 的所有文件操作。先以结构化上下文和主动报告为主，再逐步增强权限与确认。

## 3. 总体架构

```text
Frontend
  ├─ Code Node Inspector
  │   ├─ Context
  │   ├─ Timeline
  │   ├─ Files
  │   ├─ Diff
  │   ├─ Logs
  │   └─ Result
  └─ Monitor Panel

Backend
  ├─ Code Runner
  │   ├─ creates runId
  │   ├─ prepares Claude Code launch context
  │   ├─ injects MAG MCP configuration
  │   └─ streams run events to frontend
  ├─ MAG MCP Server
  │   ├─ exposes current node context
  │   ├─ exposes upstream context
  │   ├─ exposes fileScope and memory
  │   ├─ accepts step/decision/result reports
  │   └─ supports confirmation requests
  └─ Run Store
      ├─ run metadata
      ├─ reported timeline events
      ├─ changed files
      ├─ diff snapshot
      └─ final summary

Claude Code
  ├─ connects to MAG MCP Server
  ├─ calls MAG tools for context
  ├─ reports progress through MAG tools
  └─ writes final result back through MAG tools
```

## 4. 核心概念

### 4.1 Code Run

每次 Code 节点执行生成一个 `runId`。

`runId` 用于关联：

- node id
- projectDir
- projectPath
- model
- prompt
- fileScope
- upstream context
- memory
- MCP session
- reported steps
- final diff

建议数据结构：

```ts
interface CodeRun {
  id: string;
  nodeId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "done" | "error" | "cancelled" | "needs_confirmation";
  projectDir: string;
  projectPath?: string | null;
  model?: string | null;
  fileScopeAllow: string[];
  fileScopeDeny: string[];
  events: CodeRunEvent[];
  changedFiles?: string[];
  diff?: CodeDiffInfo;
  summary?: string;
  error?: string;
}
```

### 4.2 Code Run Event

所有由 MAG 自身或 MCP 工具上报的过程信息，都归一化为统一事件。

```ts
type CodeRunEventType =
  | "run_started"
  | "prompt_prepared"
  | "mcp_tool_called"
  | "mcp_tool_result"
  | "context_requested"
  | "step_reported"
  | "decision_reported"
  | "confirmation_requested"
  | "confirmation_answered"
  | "stdout"
  | "stderr"
  | "diff_captured"
  | "result_saved"
  | "run_finished"
  | "run_error";

interface CodeRunEvent {
  id: string;
  runId: string;
  nodeId: string;
  type: CodeRunEventType;
  createdAt: string;
  title: string;
  message?: string;
  path?: string;
  command?: string;
  toolName?: string;
  status?: "pending" | "running" | "done" | "error";
  payload?: unknown;
}
```

## 5. MAG MCP Server 设计

### 5.1 作用

MCP Server 让 Claude Code 在执行过程中主动访问 MAG 上下文，而不是只依赖启动时的一大段 prompt。

第一阶段 MCP Server 不直接编辑项目文件，主要提供：

- 上下文读取
- fileScope 查询
- memory 查询
- 执行步骤上报
- 决策上报
- 结果保存
- 用户确认请求

### 5.2 Run 绑定方式

Code Runner 启动 Claude Code 前生成 `runId`，并在启动 prompt 中明确要求 Claude Code 使用 MAG MCP 工具：

```text
你正在执行 MindAgentGraph Code 节点。
当前 runId 是：<runId>
请先调用 mag_get_current_node、mag_get_file_scope、mag_get_upstream_context 获取任务上下文。
执行过程中如有关键步骤、关键决策或需要用户确认的事项，请调用对应 MAG MCP 工具上报。
完成后调用 mag_save_node_result 保存总结。
```

后端需要维护 `runId -> CodeRun` 映射，MCP 工具通过 `runId` 获取对应节点上下文。

### 5.3 工具草案

#### `mag_get_current_node`

返回当前 run 对应的节点信息。

输入：

```json
{
  "runId": "string"
}
```

输出：

```json
{
  "nodeId": "string",
  "title": "string",
  "type": "code",
  "purpose": "string",
  "contextMode": "inherit",
  "systemPrompt": "string",
  "fileScope": {
    "allow": ["string"],
    "deny": ["string"]
  }
}
```

#### `mag_get_upstream_context`

返回当前节点的上游输出摘要。

输入：

```json
{
  "runId": "string",
  "maxChars": 8000
}
```

输出：

```json
{
  "items": [
    {
      "nodeId": "string",
      "title": "string",
      "type": "project_scan",
      "output": "string"
    }
  ]
}
```

#### `mag_get_file_scope`

返回当前节点允许和禁止操作的路径范围。

输入：

```json
{
  "runId": "string"
}
```

输出：

```json
{
  "projectDir": "string",
  "allow": ["frontend/src/**"],
  "deny": ["**/.env", "**/node_modules/**"]
}
```

#### `mag_get_memory`

返回节点绑定的 memory。

输入：

```json
{
  "runId": "string"
}
```

输出：

```json
{
  "memoryRef": "string",
  "content": "string"
}
```

#### `mag_report_step`

Claude Code 主动报告执行步骤。

输入：

```json
{
  "runId": "string",
  "title": "Read relevant frontend code",
  "message": "Inspecting NodeInspector and useRunNode before changing Code UI.",
  "status": "done"
}
```

输出：

```json
{
  "ok": true
}
```

#### `mag_report_decision`

Claude Code 报告关键决策。

输入：

```json
{
  "runId": "string",
  "title": "Use existing monitor store",
  "message": "The existing monitor store already supports run-level logs, so no new global event bus is needed."
}
```

输出：

```json
{
  "ok": true
}
```

#### `mag_report_file_interest`

Claude Code 报告它认为相关的文件。

输入：

```json
{
  "runId": "string",
  "path": "frontend/src/components/NodeInspector.tsx",
  "reason": "This file displays Code node details."
}
```

输出：

```json
{
  "ok": true
}
```

该工具不代表文件一定被读取或修改，只表示 Claude Code 把它标记为本次任务相关文件。

#### `mag_request_confirmation`

Claude Code 请求用户确认。

输入：

```json
{
  "runId": "string",
  "title": "Run build command",
  "message": "Claude Code wants to run npm run build in frontend.",
  "options": ["approve", "reject"]
}
```

输出：

```json
{
  "decision": "approve"
}
```

第一阶段可以先只记录确认请求，不阻塞 Claude Code。第二阶段再实现真正的阻塞等待用户输入。

#### `mag_save_node_result`

保存最终总结。

输入：

```json
{
  "runId": "string",
  "summary": "Implemented timeline tabs and diff display.",
  "changedFiles": [
    "frontend/src/components/NodeInspector.tsx"
  ]
}
```

输出：

```json
{
  "ok": true
}
```

## 6. 前端体验设计

### 6.1 Code Node Inspector Tabs

Code 节点 Inspector 建议拆成：

- `Context`
- `Timeline`
- `Files`
- `Diff`
- `Logs`
- `Result`

### 6.2 Context

展示 Claude Code 可通过 MCP 获取的 MAG 上下文：

- 当前节点 title、purpose、system prompt
- context mode
- fileScope allow/deny
- memoryRef
- 上游节点列表
- projectDir

这能让用户明确知道 Claude Code 在 MAG 里“应该看到什么”。

### 6.3 Timeline

Timeline 展示由 MAG 和 MCP 工具上报的事件。

推荐展示样式：

```text
10:21:04 Run started
10:21:05 Prompt prepared
10:21:07 Context requested: current node
10:21:08 Context requested: file scope
10:21:10 Step: inspect frontend run flow
10:21:16 Decision: reuse existing monitor store
10:21:22 Confirmation requested: run npm run build
10:21:41 Result saved
10:21:55 Diff captured: 3 files changed
10:22:12 Done
```

注意：MCP 方案只能可靠展示 Claude Code 通过 MAG MCP 工具主动上报的步骤。对于没有主动上报的内部行为，MAG 不应假装知道。

### 6.4 Files

展示本次运行相关文件：

- Claude Code 通过 `mag_report_file_interest` 主动报告的文件
- 后端最终 diff 检测出的 changed files

两类文件需要区分显示：

- `reported`
- `changed`

### 6.5 Diff

复用当前 `CodeDiffInfo`，但从长文本中独立出来。

后续增强：

- 按文件折叠
- 语法高亮
- 行级统计
- 一键复制 patch

### 6.6 Logs

显示：

- stdout
- stderr
- MCP tool errors
- confirmation 状态

## 7. 后端实施计划

### Phase 1: Run Model and Basic Events

目标：先让现有 Code runner 支持统一 run 模型和基础事件。

任务：

- 新增 `CodeRun` 和 `CodeRunEvent` schema。
- Code runner 启动时生成 `runId`。
- 在 `run_node_with_claude` 中产生基础事件：
  - `run_started`
  - `prompt_prepared`
  - `stdout`
  - `stderr`
  - `diff_captured`
  - `run_finished`
  - `run_error`
- 前端接收并展示 Timeline。

验收：

- 即使尚未接入 MCP，Code 节点也能显示运行阶段。
- diff 与 changed files 独立展示。

### Phase 2: MAG MCP Server MVP

目标：让 Claude Code 可以主动读取 MAG 上下文。

任务：

- 新增 MCP server 进程或集成到 backend。
- 实现：
  - `mag_get_current_node`
  - `mag_get_upstream_context`
  - `mag_get_file_scope`
  - `mag_get_memory`
- Code runner 启动 Claude Code 时注入 MCP 配置。
- 启动 prompt 明确要求先调用上下文工具。

验收：

- Claude Code 能通过 MCP 获取当前节点上下文。
- 启动 prompt 变短，更多上下文通过 MCP 拉取。
- Timeline 能记录 context requested 类事件。

### Phase 3: Reporting Tools

目标：让 Claude Code 可以主动向 MAG 报告步骤、决策和相关文件。

任务：

- 实现：
  - `mag_report_step`
  - `mag_report_decision`
  - `mag_report_file_interest`
  - `mag_save_node_result`
- MCP tool 调用写入 `CodeRunEvent`。
- 前端 Timeline、Files、Result 读取这些事件。

验收：

- Claude Code 可主动把关键步骤写入 Code 节点 Timeline。
- Claude Code 可主动记录关键决策。
- Claude Code 可主动标记本次任务相关文件。
- 最终总结可由 `mag_save_node_result` 写回节点。

### Phase 4: Confirmation Flow

目标：把关键动作变成用户可干预流程。

任务：

- 实现 `mag_request_confirmation`。
- 前端显示确认请求。
- 后端支持等待用户响应。
- Code run 状态支持 `needs_confirmation`。

验收：

- Claude Code 请求确认时，Code 节点状态进入 `needs_confirmation`。
- 用户确认后继续，拒绝后返回拒绝结果。

### Phase 5: MCP-based Permission Guidance

目标：在 MCP 层增强权限意识，但不假装已经具备完全强制隔离。

任务：

- `mag_get_file_scope` 输出更明确的 allow/deny 说明。
- `mag_request_confirmation` 可用于越界、高风险或不确定操作。
- `mag_report_file_interest` 对越界路径标记警告。
- Code runner 最终 diff 检测越界变更并在 Timeline 标红。

验收：

- Claude Code 能清楚知道本次任务允许和禁止的路径。
- 越界 changed files 会被 MAG 明确提示。
- 用户可以根据 Timeline 和 diff 判断是否接受结果。

## 8. 与 MAG Native Code Agent 的关系

MCP 路线不是放弃自研 code agent，而是先建设共同底座：

- Run Model
- Context Model
- Timeline UI
- FileScope 表达
- Diff 展示
- Confirmation Flow
- Run History

这些能力未来可以同时服务：

- Claude Code executor
- MAG Native Patch executor
- MAG Native Tool Agent executor
- OpenAI/Anthropic/DeepSeek function-calling executor

建议在 MCP 路线稳定后，再加入 `MAG Native Patch` 作为轻量 fallback。

## 9. 风险与对策

### 9.1 过度依赖 Claude Code

风险：Claude Code CLI 或 MCP 配置方式变化会影响 MAG。

对策：

- 将 Claude Code executor 封装成独立 service。
- 统一输出 `CodeRunEvent`，避免前端绑定 Claude Code 特定行为。
- 后续补 `MAG Native Patch` fallback。

### 9.2 MCP 工具被模型忽略

风险：Claude Code 不一定主动调用 MAG MCP 工具。

对策：

- 启动 prompt 明确要求先调用 `mag_get_current_node`、`mag_get_file_scope` 和 `mag_get_upstream_context`。
- 将关键上下文仍保留一份短摘要在启动 prompt 中。
- 对未调用 MCP 的 run 做日志警告，不阻塞第一阶段。

### 9.3 上报信息不完整

风险：MCP 只能记录 Claude Code 主动上报的步骤，不能保证覆盖所有内部行为。

对策：

- Timeline 中明确区分 `reported` 与 `detected`。
- 最终变更仍以 git diff 和文件快照为准。
- UI 不把未上报的行为伪装成已知事实。

### 9.4 fileScope 不是强隔离

风险：只靠 MCP 上下文和 prompt 不能保证完全防止越界修改。

对策：

- 第一阶段明确标注为权限指导和结果审计。
- 最终 diff 检测越界 changed files。
- 后续探索更强的执行沙箱或工作树隔离。

## 10. 推荐优先级

建议按以下顺序实现：

1. `CodeRun` / `CodeRunEvent` 统一模型。
2. 前端 Code Inspector 的 `Context` 和 `Timeline`。
3. 当前 Claude Code runner 产生基础事件。
4. MAG MCP Server MVP。
5. MCP context tools。
6. MCP reporting tools。
7. Confirmation Flow。
8. MCP-based Permission Guidance。
9. MAG Native Patch fallback。

## 11. 一句话总结

MAG 当前不应该立刻自研完整 code agent。更合适的路线是：

> 先把 MAG 做成 Claude Code 可调用的 MCP 上下文与协作服务器，让 Claude Code 在 MAG 的节点、上下文、fileScope、memory 和 run 记录中工作；等执行底座成熟后，再逐步引入 MAG Native code executor。
