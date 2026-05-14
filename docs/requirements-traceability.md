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
| 节点连接（手动拖拽） | ✅ | React Flow `onConnect` → `Canvas.tsx:124` |
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
| 独立 Prompt | ❌ | 节点无独立 system prompt 字段，全局复用 `PLANNER_SYSTEM` |
| 独立 Memory | ❌ | `memoryRef` 字段已定义但无读写逻辑 |
| 独立 Rules（工具权限） | ❌ | `toolPolicy` 字段已定义但完全未使用 |
| 独立文件范围 | ⚠️ | `fileScope` 可编辑；code 节点运行时过滤文件；prompt 节点忽略 |
| 独立资源访问权限 | ❌ | |
| contextMode 三种模式 | ❌ | `inherit/explicit/isolated` 字段存在，运行时无任何分支逻辑 |
| 上下游上下文传播 | ⚠️ | code 节点接收上游 `data.output`（截断 600 字符）；prompt 节点不接收 |
| **AI 只在当前节点上下文工作** | ❌ | 核心卖点未落地 |

---

## 3. Agent 系统

| 需求 | 状态 | 说明 |
|------|------|------|
| 一个节点 = 一个 Agent | ❌ | `agent` 类型节点存在，仅占位 |
| 多 Agent 协作 | ❌ | |
| 总控 Agent 调度 | ❌ | |
| Agent 消息通信 | ❌ | |
| Agent 任务分发 | ❌ | |

---

## 4. AI 规划能力

| 需求 | 状态 | 说明 |
|------|------|------|
| AI 生成系统结构图 | ✅ | `/plan` 端点，一句话 → DAG (nodes+links) |
| AI 拆分节点 | ✅ | planner 按 5-12 个节点生成，含 type/purpose/position |
| 生成子任务 | ⚠️ | 节点有 type 和 purpose，但无子任务关联机制 |
| 链式执行 | ❌ | 只能逐节点手动 Explain/Code，无 DAG 拓扑排序自动执行 |
| 生成代码 | ⚠️ | code 节点可调 Claude Code CLI，但仅单节点独立执行 |

---

## 5. 多模态资源管理

| 需求 | 状态 |
|------|------|
| 图片 / 视频 / 音频 / 文档 / 3D 资源绑定 | ❌ |
| `assets/` 目录有占位 | ❌ |

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
| 右侧面板（节点上下文/Memory/Prompt） | ⚠️ | NodeInspector 有 title/type/contextMode/fileScope，缺独立 Prompt、Memory、推理过程 |
| 底部面板（AI 日志/Token/Agent通信） | ❌ | 日志仅后端 console |
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
| DeepSeek 接入 | ✅ | OpenAI-compatible provider |
| OpenAI 接入 | ❌ | |
| Gemini 接入 | ❌ | |
| 多模型切换 | ✅ | SettingsPanel + providerStore |
| Agent 路由 | ❌ | |
| Prompt 编排 | ❌ | |

---

## 9. 工程存储

| 需求 | 状态 | 说明 |
|------|------|------|
| `.mag` 文件夹工程 | ✅ | `project.json` + `graphs/` + `memory/` + `assets/` |
| Git 友好存储 | ✅ | JSON 格式，扁平 nodes/links |
| API Key 不进工程文件 | ✅ | localStorage + X-Provider-Key header |

---

## 10. 高级功能（远期）

以下全部 ❌：

- Semantic Map 语义地图
- 长期记忆系统
- 自动项目拆分
- AI 自我反思
- 自动上下文压缩
- MCP 工具系统
- Git 工程理解
- 自动代码修复
- AI 任务队列
- 节点自动生成（已有一句话→DAG，但无增量追加）

---

## 完成度概览

```
✅ 已实现:  ~15%   基础节点系统、画布、双 provider、项目存储
⚠️ 半实现:  ~10%   fileScope、code 节点上下游、NodeInspector
❌ 未实现:  ~75%   Agent 系统、上下文隔离、多模态、游戏引擎、高级功能
```

## 下一阶段优先级建议 (M2)

1. **上下文传播打通** — prompt 节点运行时接入上游 output（对齐 code 节点）
2. **contextMode 生效** — inherit 合并父上下文、explicit 仅自己的 prompt、isolated 完全隔离
3. **独立 Prompt** — 每个节点可编辑自己的 system prompt，覆盖全局默认
4. **Memory 接入** — memoryRef 读写 `.mag/memory/`，运行时注入
5. **DAG 链式执行** — 拓扑排序，自动按依赖顺序执行节点链
