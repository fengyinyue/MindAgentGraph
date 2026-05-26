# MAG MCP Future Capabilities

## 1. 定位

当前 MCP MVP 更偏向“当前 Code Run 的上下文读取和执行上报”。它已经能让 Claude Code 理解当前节点、读取上游上下文、查询 fileScope、上报步骤与结果。

下一阶段 MCP 应该从“单节点辅助工具”升级成“图形化 AI 编程控制台”的协作协议。目标不是让 Claude Code 随意改图，而是让它可以读图、理解图、建议改图，并把执行过程沉淀回 MAG。

一句话目标：

> 让 Claude Code 能读图、理解图、建议改图，但真正应用 DAG 变更必须经过 MAG 前端确认。

## 2. 上下文 MCP

目标：让 Claude Code 能稳定理解当前任务所在的 MAG 环境。

已有或应继续完善的工具：

```text
mag_get_current_node
mag_get_upstream_context
mag_get_file_scope
mag_get_memory
mag_report_step
mag_report_decision
mag_save_node_result
```

补强方向：

- `mag_get_current_node` 返回更完整的节点字段，包括 run history、最近一次 diff 摘要、confirmation 状态。
- `mag_get_upstream_context` 支持按 node type、距离、输出长度过滤。
- `mag_get_file_scope` 返回更明确的权限解释，而不仅是 allow/deny 数组。
- `mag_get_memory` 支持多个 memoryRef 或 project-level memory。

## 3. 图理解 MCP

目标：让 Claude Code 不只看到当前节点，也能理解当前 DAG。

建议新增工具：

```text
mag_get_graph_summary
mag_get_node_details
mag_get_downstream_nodes
mag_get_sibling_nodes
mag_find_relevant_nodes
```

### `mag_get_graph_summary`

返回当前图的节点和边摘要。

输入：

```json
{
  "runId": "string",
  "maxNodes": 80
}
```

输出：

```json
{
  "nodes": [
    {
      "id": "node-id",
      "type": "code",
      "title": "Implement MCP timeline",
      "purpose": "Add timeline display for MCP events",
      "hasOutput": true
    }
  ],
  "links": [
    {
      "source": "scan-node-id",
      "target": "code-node-id"
    }
  ]
}
```

### `mag_get_node_details`

按 id 获取某个节点的完整上下文。

输入：

```json
{
  "runId": "string",
  "nodeId": "string"
}
```

输出应包含：

- title
- type
- purpose
- contextMode
- fileScope
- memoryRef
- output summary
- run history summary

## 4. 图变更 MCP

目标：让 Claude Code 可以建议新增、修改、连接节点，但不直接静默改图。

核心原则：

> MCP 可以提出 graph patch，MAG 前端负责审查和应用。

建议新增工具：

```text
mag_propose_graph_patch
mag_get_pending_graph_patches
mag_cancel_graph_patch
```

### `mag_propose_graph_patch`

Claude Code 用这个工具建议修改 DAG。

输入：

```json
{
  "runId": "string",
  "reason": "当前 Code 节点完成后，还需要补测试和文档节点。",
  "nodes": [
    {
      "clientId": "new-test-node",
      "type": "task",
      "title": "补充 MCP 回归测试",
      "purpose": "验证 MCP run event 不破坏现有 Code 节点执行",
      "contextMode": "inherit",
      "fileScope": {
        "allow": ["backend/tests/**", "frontend/src/**"],
        "deny": []
      }
    },
    {
      "clientId": "new-doc-node",
      "type": "memory",
      "title": "记录 MCP 使用经验",
      "purpose": "沉淀本次 MCP 改造的设计取舍"
    }
  ],
  "links": [
    {
      "source": "current",
      "target": "new-test-node"
    },
    {
      "source": "current",
      "target": "new-doc-node"
    }
  ]
}
```

输出：

```json
{
  "patchId": "graph-patch-id",
  "status": "pending_review"
}
```

前端行为：

- 在 Code 节点 Timeline 中显示“Claude 建议修改图”。
- 打开 Graph Patch Review 面板。
- 展示将新增/修改/删除的节点和边。
- 用户点击 Apply 后才写入 Zustand graph store。

第一版建议只支持：

- 新增节点
- 新增边
- 修改当前节点的 title/purpose/fileScope

暂不支持：

- 删除节点
- 删除边
- 批量重排布局
- 跨子图复杂移动

## 5. 执行会话 MCP

目标：让每一次 Code Run 成为可复盘的开发会话，而不是一段混合日志。

建议新增工具：

```text
mag_report_file_interest
mag_report_risk
mag_report_blocker
mag_report_test_result
mag_report_followup
mag_save_run_summary
```

### `mag_report_blocker`

当 Claude Code 无法继续时，主动报告阻塞原因。

输入：

```json
{
  "runId": "string",
  "title": "缺少后端图变更接口",
  "message": "当前 MCP server 能上报事件，但后端没有持久化 pending graph patch 的 API。",
  "suggestedNextStep": "创建一个 task 节点设计 graph patch store。"
}
```

后续可以与 `mag_propose_graph_patch` 联动：Claude Code 报告 blocker 后，同时建议创建一个 follow-up 节点。

### `mag_report_test_result`

记录测试或构建结果。

输入：

```json
{
  "runId": "string",
  "command": "npm run build",
  "status": "error",
  "summary": "TypeScript failed in NodeInspector.tsx",
  "details": "..."
}
```

前端展示：

- Timeline 中显示测试结果。
- Result 区显示最后一次测试状态。
- 失败时可一键创建 follow-up 修复节点。

## 6. 确认与权限 MCP

目标：把 fileScope 从静态提示升级成可协商流程。

建议新增工具：

```text
mag_request_confirmation
mag_request_file_scope_expansion
mag_request_command_approval
```

### `mag_request_file_scope_expansion`

当 Claude Code 发现必须访问当前 fileScope 之外的文件时，不能直接假设可以修改，而是请求扩展范围。

输入：

```json
{
  "runId": "string",
  "reason": "需要新增 /mcp/graph-patch 后端接口。",
  "requestedAllow": [
    "backend/app/main.py",
    "backend/app/schemas.py",
    "backend/app/services/graph_patch_store.py"
  ]
}
```

前端行为：

- 在 Code 节点中显示 fileScope expansion request。
- 用户确认后更新当前节点 fileScope。
- Timeline 记录 confirmation_answered。

## 7. 项目知识 MCP

目标：让 MAG 越用越懂当前项目，而不是每次 Code Run 都重新探索。

建议新增工具：

```text
mag_search_memory
mag_save_memory
mag_get_project_profile
mag_update_project_profile
mag_get_known_patterns
mag_save_known_pattern
```

项目知识可以包括：

- 代码结构约定
- 常用命令
- 测试入口
- 节点类型使用习惯
- 前端 store 模式
- 后端 API 模式
- 不能触碰的路径
- 已知技术债

示例：

```json
{
  "pattern": "Graph state is frontend-owned",
  "description": "The authoritative editable graph lives in frontend Zustand store. Backend MCP tools should propose graph patches instead of directly mutating frontend state.",
  "files": [
    "frontend/src/store/graphStore.ts"
  ]
}
```

## 8. 多节点编排 MCP

目标：让 Claude Code 可以协助维护整个执行图。

建议新增工具：

```text
mag_mark_node_blocked
mag_mark_node_done
mag_create_followup_task
mag_split_current_node
mag_suggest_next_run_order
```

这些工具可以先全部走 proposal，不直接应用。

典型场景：

- 当前 Code 节点完成后，Claude Code 建议新增测试节点、review 节点、文档节点。
- 当前任务过大，Claude Code 建议拆成三个子节点。
- 当前节点阻塞，Claude Code 标记 blocker 并建议上游补充一个 analysis 节点。
- 多个节点已准备好，Claude Code 建议下一步运行顺序。

## 9. 下一阶段推荐实现顺序

建议按以下顺序推进后续 MCP 能力：

1. `mag_get_graph_summary`
2. `mag_get_node_details`
3. `mag_propose_graph_patch`
4. Graph Patch Review UI
5. `mag_report_blocker`
6. `mag_report_test_result`
7. `mag_request_file_scope_expansion`
8. Project Memory / Known Patterns
9. 多节点编排 proposal tools

其中最关键的是：

```text
mag_get_graph_summary
mag_propose_graph_patch
Graph Patch Review UI
```

这三项完成后，MAG 的 MCP 就不只是“给 Claude Code 当前节点上下文”，而是开始具备“让 Claude Code 参与维护任务图”的能力。
