# MindAgentGraph 产品提案

## 1. 产品定位

MindAgentGraph 是一个节点式 AI 创作规划工具，面向需要长期规划、拆解和执行复杂项目的创作者与开发者。

它不是传统聊天 AI，而是一个用于组织 AI 工作上下文的可视化节点系统。用户通过节点、连线、上下文、记忆和文件范围来约束 AI 的工作边界，让 AI 在明确的任务结构中协助规划、生成、解释和迭代项目。

一句话定位：

> AI 时代的 Unreal Blueprint + Notion + Agent OS。

参考对象：

- Unreal Blueprint：节点化结构和依赖关系
- Houdini / ComfyUI：图式工作流和可组合流程
- Notion：项目知识、任务和文档组织
- Agent OS：多 Agent 协作、调度和执行记录

## 2. 核心问题

当前聊天式 AI 在复杂项目中有几个明显问题：

- 上下文容易混乱，长期项目难以持续维护。
- AI 对整个工程的理解范围过大，容易修改无关文件。
- 任务拆分、执行、记忆和结果之间缺少可视化结构。
- 多 Agent 协作缺少明确边界、通信记录和调度机制。
- 创作型项目中的资源、设定、代码和计划分散在不同工具中。

MindAgentGraph 的核心目标是把 AI 工作从“连续聊天”改造成“结构化节点规划与执行”。

## 3. 核心理念

- 节点不是简单的代码块，而是 AI 的思维结构。
- 每个节点代表一个独立任务、模块、Agent、资源或系统。
- AI 应该在当前节点的上下文范围内工作，而不是污染整个工程。
- 节点负责管理 Prompt、Memory、目标、文件范围、依赖关系和执行输出。
- 连线表示上下游依赖、上下文继承或 Agent 通信关系。
- 图结构既是项目计划，也是 AI 执行的可视化控制面板。

## 4. 目标用户

优先面向以下用户：

- 独立游戏开发者
- AI 辅助编程用户
- 需要拆解复杂项目的产品/技术负责人
- 使用 Claude Code、Cursor、Codex 等工具进行长期工程迭代的开发者
- 需要组织设定、资源、任务和 Agent 工作流的创作者

第一阶段优先服务“AI 辅助软件/游戏项目规划与执行”场景。

## 5. MVP 范围

MVP 目标是验证“节点级上下文管理 + AI 规划执行”是否成立。

MVP 必须包含：

- 可视化 DAG 节点画布
- 手动创建、编辑、拖拽、连接和删除节点
- AI 根据目标自动生成节点图
- 节点级 Prompt、Memory、FileScope、ContextMode
- 单节点 Explain 执行
- Code 节点调用代码执行工具，并注入节点上下文和文件范围
- DAG 按依赖顺序批量执行
- 项目保存/加载
- 基础 Provider 配置和模型切换
- 右侧节点检查器
- 基础执行日志和错误反馈

MVP 暂不包含：

- 完整多 Agent 运行时
- 强制文件沙箱
- 多用户协作
- 实时云同步
- 自动生成 Unreal Blueprint / PCG Graph / Behavior Tree
- 完整多模态资源管理
- 向量数据库级长期记忆
- 插件市场或复杂权限系统

## 6. 核心功能

### 6.1 节点系统

基础能力：

- 创建节点
- 编辑节点标题、类型、目标和 Prompt
- 节点连接
- 节点拖拽
- 节点删除
- 无限画布
- DAG 拓扑执行

后续能力：

- 分组
- 注释
- 折叠
- 子图 SubGraph
- 节点模板
- 节点版本历史

### 6.2 节点类型

| 类型 | 作用 | MVP 状态 |
|------|------|----------|
| Prompt | 承载普通 AI 任务，输出文本结果 | 必须 |
| Planning | 根据目标拆分结构和子任务 | 必须 |
| Code | 生成或修改代码，受 FileScope 约束 | 必须 |
| Memory | 读写长期记忆或项目知识 | 必须 |
| File Scope | 定义允许/禁止访问的文件范围 | 必须 |
| Task | 表示可执行任务及状态 | 后续 |
| Agent | 表示独立 Agent 实例 | 后续 |
| API | 调用外部服务或工具 | 后续 |
| Asset | 绑定图片、视频、音频、3D 等资源 | 后续 |
| Semantic | 表示概念、设定、语义地图或知识节点 | 后续 |

### 6.3 AI Context System

这是产品的核心。

每个节点拥有独立上下文：

- `purpose`：节点目标
- `systemPrompt`：节点级系统提示
- `memoryRef`：节点绑定的记忆文件或记忆键
- `fileScope`：允许访问或建议处理的文件范围
- `toolPolicy`：工具权限规则
- `contextMode`：上下文继承模式
- `inputs`：上游节点输出
- `output`：当前节点执行结果
- `runHistory`：执行历史和日志

上下文模式：

| 模式 | 行为 |
|------|------|
| `inherit` | 继承上游节点输出、读取 Memory，并拼入当前 Prompt |
| `explicit` | 只使用当前节点显式字段和用户输入 |
| `isolated` | 不继承上游，不读写 Memory，用于隔离任务 |

执行时上下文拼装顺序：

1. 全局系统规则
2. 当前节点类型规则
3. 当前节点 `systemPrompt`
4. 当前节点 `purpose`
5. 当前节点 `fileScope`
6. 当前节点 `memoryRef` 内容
7. 上游节点输出
8. 用户本次执行输入

FileScope 的语义需要明确区分两层：

- MVP：作为提示约束注入给 AI 和代码工具。
- 后续：升级为强制沙箱或文件访问拦截机制。

### 6.4 Agent 系统

Agent 是节点系统的高级形态。

短期目标：

- 每个节点具备独立 Prompt、Memory、ContextMode 和执行输出。
- DAG 执行器可以按依赖顺序调度节点。

中期目标：

- 一个 Agent 节点对应一个独立运行时。
- Agent 拥有生命周期：创建、运行、暂停、取消、完成、失败。
- Agent 之间通过消息通道通信。
- 总控 Agent 负责任务分发、结果汇总和冲突处理。

后期目标：

- 多 Agent 并行执行。
- Agent 能订阅节点变化和项目事件。
- Agent 可调用 MCP 工具和外部 API。

### 6.5 AI 规划能力

AI 不应该直接从一句话跳到生成代码，而应该先生成结构。

推荐流程：

1. 用户输入项目目标。
2. Planning 节点生成系统结构。
3. 系统结构拆分为节点图。
4. 每个节点生成目标、Prompt、FileScope 和依赖关系。
5. 用户审查和调整节点。
6. AI 按 DAG 顺序执行节点。
7. 执行输出回写到节点和 Memory。

示例：

```text
CityGenerator
├── Terrain
├── Road
├── Plot
├── Building
├── NPC
└── Traffic
```

### 6.6 多模态资源管理

后续节点应支持绑定：

- 图片
- 视频
- 音频
- 文档
- Prompt
- 参考资料
- 3D 资源

MVP 只需要预留数据结构和资源引用字段，不需要完整资源管理器。

### 6.7 游戏开发支持

游戏开发是重点方向，但不应挤压 MVP。

优先支持：

- Unreal Engine 项目结构理解
- Houdini / PCG 工作流规划
- Blueprint 逻辑拆解
- Behavior Tree 设计
- State Machine 设计

后续支持：

- 自动生成 Blueprint 描述
- 自动生成 PCG Graph 结构
- 自动生成行为树结构
- 与 Unreal Editor 插件联动

第一阶段只做“规划和代码辅助”，不直接生成引擎原生资产。

## 7. UI 结构

### 7.1 主布局

左侧面板：

- 节点树
- 项目结构
- Agent 列表

中间区域：

- 无限画布
- 节点编辑
- AI 工作流

右侧面板：

- 当前节点上下文
- Prompt
- Memory
- FileScope
- 执行输出
- 资源引用

底部面板：

- AI 日志
- Agent 通信
- Token 使用情况
- 执行队列

### 7.2 视觉风格

- 深色工作台风格
- 类似 UE Blueprint + Figma + Notion 的组合
- 强调信息密度和长期使用效率
- 节点连接线可在后续加入流动效果
- 避免过度装饰，优先保证复杂图的可读性

## 8. 技术方向

前端：

- React
- TypeScript
- Tailwind CSS
- React Flow / @xyflow/react
- Zustand

后端：

- Python FastAPI
- REST API + SSE
- Provider 抽象层
- Agent Runtime
- Memory 服务
- Task Queue

桌面端：

- Tauri
- 本地文件读写
- 后端 sidecar 进程管理

AI Provider：

- Claude
- DeepSeek
- OpenAI
- Gemini

存储：

- `.mag/` 项目目录
- JSON 存图结构
- Markdown 存 Memory
- assets 目录存资源
- Git 友好格式

## 9. 阶段规划

### Phase 1：节点规划与执行

目标：验证核心闭环。

- DAG 画布
- 节点编辑
- AI 生成节点图
- 节点级上下文
- Explain / Code 执行
- DAG 顺序执行
- 项目保存加载

### Phase 2：工作台布局与可观测性

目标：让工具可用于真实项目。

- 左侧项目浏览器
- 底部日志面板
- 执行队列
- Token 统计
- 节点运行历史
- 更完整的错误展示

### Phase 3：Agent 编排

目标：从节点执行升级为 Agent 协作。

- Agent 节点运行时
- Agent 通信协议
- Supervisor 调度
- 多 Agent 任务分发
- 并行执行和取消

### Phase 4：资源与语义系统

目标：支持复杂创作项目。

- 多模态资源绑定
- 资源管理器
- Semantic Map
- 长期记忆索引
- 自动上下文压缩

### Phase 5：游戏开发深度集成

目标：服务 Unreal / Houdini / PCG 工作流。

- 游戏项目结构理解
- Blueprint / Behavior Tree / State Machine 结构生成
- PCG Graph 规划
- 引擎插件或桥接工具

## 10. 非目标

以下内容不是 MVP 目标：

- 替代完整 IDE
- 替代 Unreal Editor 或 Houdini
- 成为通用聊天机器人
- 做复杂团队协作 SaaS
- 直接执行不受控的任意代码
- 承诺 AI 一次性完成大型项目
- 在没有用户确认的情况下批量改动整个工程

## 11. 验收标准

MVP 达成标准：

- 用户可以输入一个复杂目标并生成节点图。
- 用户可以手动调整节点和连线。
- 每个节点可以配置 Prompt、Memory、FileScope 和 ContextMode。
- 单个节点可以独立执行并保存输出。
- DAG 可以按依赖顺序执行。
- Code 节点执行时能注入当前节点上下文和文件范围。
- 项目可以保存并重新打开。
- 节点执行失败时有明确错误反馈。
- 用户能看出 AI 当前在哪个节点工作、使用了什么上下文、产生了什么输出。

体验达成标准：

- 用户不是在和 AI 闲聊，而是在搭建 AI 工作结构。
- 用户可以控制 AI 的工作边界。
- 项目的规划、执行、记忆和输出都能回到节点图中。
- 大型项目可以被拆成可理解、可执行、可追踪的局部任务。

## 12. 与其他文档的分工

本文档负责定义产品愿景、范围边界和阶段目标。

详细内容放在其他文档中维护：

- `docs/high-level-design.md`：系统概要架构
- `docs/detailed-design.md`：详细设计、数据结构和接口
- `docs/requirements-traceability.md`：需求实现状态追踪
- `docs/tasks/`：具体里程碑任务和执行清单
