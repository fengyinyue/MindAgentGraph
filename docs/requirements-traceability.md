# 需求追溯矩阵

> 需求来源：Obsidian Vault/MindAgentGraph/提示词.md
> 更新日期：2026-05-14

## 状态标记说明

| 标记 | 含义 |
|------|------|
| ✅ | 已实现 |
| ⚠️ | 半实现（数据结构就绪但运行时不生效，或仅部分节点类型支持） |
| ❌ | 未实现 |

---

## 1. 节点系统

| 需求 | 状态 | 实现位置 / 说明 |
|------|------|-----------------|
| 创建节点（手动） | ✅ | Canvas 右键菜单、Toolbar +Node 按钮、键盘 N |
| 创建节点（AI 生成） | ✅ | PlanInput → `/plan` → `planner.plan_graph()` |
| 节点连接（手动拖拽） | ✅ | React Flow `onConnect` → `Canvas.tsx` |
| 节点拖拽移动 | ✅ | React Flow 内置 |
| 节点删除 | ✅ | Backspace/Delete 键、右键菜单 Delete |
| 节点标题/类型编辑 | ✅ | NodeInspector 输入框和下拉 |
| 分组 | ❌ | |
| 注释 | ❌ | |
| 折叠 | ❌ | |
| 子图 (SubGraph) | ❌ | |
| 无限画布 | ✅ | React Flow 内置 |
| 10 种节点类型定义 | ✅ | `shared/types.ts` + `schemas.py` + JSON Schema |

---

## 2. AI 上下文管理（核心）

| 需求 | 状态 | 说明 |
|------|------|------|
| 独立 Prompt | ✅ | `systemPrompt` 已进入 schema/type/UI；Explain 和 Code 运行时都会使用节点级 system prompt |
| 独立 Memory | ✅ | `memoryRef` 可编辑；后端通过 `.mag/memory/` 读写节点 Memory，并做路径逃逸保护 |
| 独立 Rules（工具权限） | ❌ | `toolPolicy` 字段已定义但运行时未使用 |
| 独立文件范围 | ⚠️ | `fileScope` 可编辑；Code 节点会注入 Claude Code 提示约束，但尚未做强制沙箱/拦截；Prompt 节点忽略 |
| 独立资源访问权限 | ❌ | |
| contextMode 三种模式 | ✅ | `inherit` 注入上游输出和 Memory；`explicit` 仅使用当前节点信息/Prompt；`isolated` 不读写 Memory、不继承上游 |
| 上下游上下文传播 | ✅ | Explain 和 Code 都会按拓扑上游收集节点 `output/codeOutput`，在 `inherit` 模式下注入 |
| **AI 只在当前节点上下文工作** | ⚠️ | Prompt/Memory/contextMode 已生效；Code 节点仍依赖 Claude Code 自律遵守 fileScope，缺少硬隔离 |

---

## 3. Agent 系统

| 需求 | 状态 | 说明 |
|------|------|------|
| 一个节点 = 一个 Agent | ⚠️ | 每个节点已拥有独立 Prompt/Memory/contextMode 并可单独运行；`agent` 类型仍未具备专用运行时 |
| 多 Agent 协作 | ❌ | |
| 总控 Agent 调度 | ⚠️ | Run DAG 可按依赖顺序调度节点，但不是完整 Agent orchestrator |
| Agent 消息通信 | ❌ | |
| Agent 任务分发 | ❌ | |

---

## 4. AI 规划能力

| 需求 | 状态 | 说明 |
|------|------|------|
| AI 生成系统结构图 | ✅ | `/plan` 端点，一句话 → DAG (nodes+links) |
| AI 拆分节点 | ✅ | planner 按 5-12 个节点生成，含 type/purpose/position |
| 生成子任务 | ⚠️ | 节点有 type 和 purpose，但无更细的任务对象/状态机 |
| 链式执行 | ✅ | Toolbar `Run DAG` 使用拓扑排序，按依赖顺序自动执行 Explain/Code 节点 |
| 生成代码 | ✅ | Code 节点调用 Claude Code CLI，支持工程目录、上游上下文、Memory、节点 Prompt、生成文件列表 |
| Code 运行取消 | ✅ | 前端 cancel 调后端取消接口；后端按 `runId` 追踪进程，Windows 用 `taskkill /T /F` 杀进程树 |
| ClaudeCode 运行状态日志 | ✅ | 后端控制台输出 START/RUNNING/CANCEL/CANCELLED/EXIT/DONE/ERROR 等状态 |

---

## 5. 多模态资源管理

| 需求 | 状态 |
|------|------|
| 图片 / 视频 / 音频 / 文档 / 3D 资源绑定 | ❌ |
| `assets/` 目录有占位 | ⚠️ |

---

## 6. 游戏开发支持

| 需求 | 状态 |
|------|------|
| UE Blueprint / PCG Graph / Behavior Tree / State Machine | ❌ |
| 自动生成 Blueprint / PCG Graph / 行为树 | ❌ |

---

## 7. UI 设计

| 需求 | 状态 | 说明 |
|------|------|------|
| 左侧面板（节点树/项目结构） | ❌ | |
| 中间画布（无限画布 + 节点编辑） | ✅ | Canvas + ReactFlow + Controls + MiniMap |
| 右侧面板（节点上下文/Memory/Prompt） | ✅ | NodeInspector 支持 title/type/contextMode/purpose/systemPrompt/memoryRef/fileScope，并展示输出和生成文件 |
| 底部面板（AI 日志/Token/Agent通信） | ❌ | 暂无底部面板；ClaudeCode 状态仅后端 console |
| 黑色科技感主题 | ✅ | Tailwind 暗色 |
| 连接线动态流动 | ❌ | 静态 SVG 边 |

---

## 8. 技术架构

| 需求 | 状态 | 说明 |
|------|------|------|
| React + TypeScript + Tailwind | ✅ | |
| React Flow 节点系统 | ✅ | `@xyflow/react` v12 |
| Zustand 状态管理 | ✅ | graphStore + keyStore + providerStore |
| Python FastAPI 后端 | ✅ | PyInstaller sidecar |
| Claude 接入 | ✅ | Anthropic provider |
| Claude Code CLI 接入 | ✅ | Code 节点执行 `claude --print`，支持 SSE 输出、取消和后端状态日志 |
| DeepSeek 接入 | ✅ | OpenAI-compatible provider |
| OpenAI 接入 | ❌ | |
| Gemini 接入 | ❌ | |
| 多模型切换 | ✅ | SettingsPanel + providerStore |
| Agent 路由 | ❌ | |
| Prompt 编排 | ⚠️ | 已有节点 Prompt/contextMode/Memory/上游输出拼装，缺少可视化编排和版本管理 |

---

## 9. 工程存储

| 需求 | 状态 | 说明 |
|------|------|------|
| `.mag` 文件夹工程 | ✅ | `project.json` + `graphs/` + `memory/` + `assets/` |
| Git 友好存储 | ✅ | JSON 格式，扁平 nodes/links |
| API Key 不进工程文件 | ✅ | localStorage + X-Provider-Key header |

---

## 10. 高级功能（远期）

| 需求 | 状态 | 说明 |
|------|------|------|
| Semantic Map 语义地图 | ❌ | |
| 长期记忆系统 | ⚠️ | 已有 `.mag/memory/` 文件级 Memory；尚无索引、检索、压缩和跨项目长期记忆 |
| 自动项目拆分 | ❌ | |
| AI 自我反思 | ❌ | |
| 自动上下文压缩 | ⚠️ | 当前仅做简单截断，未做语义压缩 |
| MCP 工具系统 | ❌ | |
| Git 工程理解 | ⚠️ | Code 运行后用 `git status --porcelain` 检测变更文件，但没有完整 Git 语义理解 |
| 自动代码修复 | ❌ | |
| AI 任务队列 | ⚠️ | Run DAG 支持顺序执行，但没有持久队列、重试、暂停/恢复 |
| 节点自动生成（增量追加） | ❌ | 已有一句话→DAG，缺少对现有图的增量扩展 |

---

## 完成度概览

```
✅ 已实现:  ~35%   基础节点系统、画布、双 provider、项目存储、上下文传播、Memory、DAG 执行、ClaudeCode 取消/日志
⚠️ 半实现:  ~25%   fileScope 硬隔离、Agent 运行时、Prompt 编排、长期记忆、任务队列
❌ 未实现:  ~40%   多 Agent 协作、多模态、游戏引擎、底部日志面板、高级工程理解
```

## 下一阶段优先级建议 (M3)

1. **fileScope 强制执行** — 对 Claude Code 文件操作做硬拦截/沙箱，避免只靠 prompt 约束
2. **底部运行日志面板** — 把后端 ClaudeCode 状态、Token、Agent 通信流展示到 UI
3. **Agent 运行时** — 为 `agent` 节点增加消息、工具权限、任务分发和协作协议
4. **多模态资源绑定** — 节点关联 `.mag/assets/` 下的图片/音频/文档/3D 资源
5. **OpenAI/Gemini Provider** — 补齐更多模型接入和统一 Provider 配置
