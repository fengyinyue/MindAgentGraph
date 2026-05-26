# MindAgentGraph

<p align="center">
  <b>节点式 AI 创作规划工具</b>，面向需要长期规划、拆解和执行复杂项目的创作者与开发者。
</p>

<p align="center">
  <a href="README.md">English</a> | <b>中文</b>
</p>

---

## 这是什么？

MindAgentGraph **不是聊天 AI**。它是一个用于组织 AI 工作上下文的可视化节点系统——你可以把它理解为一个控制面板，其中节点、连线、上下文、记忆和文件范围共同定义了 AI 的工作边界。

你不用再和越来越长的聊天记录较劲，而是构建一个**可视化的思维节点 DAG**。每个节点都是一个独立工作单元，拥有自己的目标、Prompt、记忆引用、文件范围、依赖关系和执行输出。连线定义上下游关系与上下文继承。图结构既是你的**项目计划**，也是你的 **AI 执行仪表盘**。

## 聊天式 AI 的问题

聊天式 AI 在复杂项目中会逐渐失控：

- **上下文混乱。** 长对话容易跑偏，几周后很难回过头来审视或调整某个计划。
- **修改越界。** AI 看到太多项目内容，会修改不该动的文件。
- **缺少全局视角。** 任务、依赖、记忆和结果散落在各轮对话中，没有鸟瞰图。
- **多 Agent 协作混乱。** 多个 Agent 或子任务协作时，缺少明确的边界、通信记录和调度机制。
- **资源分散。** 代码、设计、设定和计划分散在不同工具中，缺乏统一结构。

MindAgentGraph 的核心目标是把 AI 工作从"连续聊天"改造成**结构化节点规划与执行**。

## 核心理念

- **节点**不是代码块，而是 AI 的思维结构：任务、模块、Agent、资源或系统组件。
- AI 在 **当前节点的上下文范围内** 工作，不污染整个工程。
- 节点负责管理自己的 **Prompt、Memory、目标、文件范围、依赖关系和输出**。
- 连线表示 **上下游依赖、上下文继承或 Agent 通信关系**。
- 图结构既是**持续演进的项目计划**，也是**可视化的执行控制面板**。

## 图类型设计

MindAgentGraph 将高层工作流规划和细节结构设计拆成两种图：

- **Workflow Graph**（`workflow_graph`）是高层执行计划。它负责把目标拆成粗粒度工作包，例如调研、架构、实现、验证和交付。Workflow 展开使用普通规划逻辑，并刻意避免端口级数据流。
- **Structure Graph**（`structure_graph`）是细节数据流或依赖图。它适合资源管线、模块结构、资产流、生成规则、节点蓝图等需要显式输入、输出和类型化连线的场景。
- **轻量 subgraph** 会把 Structure Graph 的内部节点收纳在 Structure Graph 节点内部。双击或进入 Structure Graph 可以查看内部细节，顶层 Workflow Graph 保持干净，只负责组织和调度。
- 旧版 `planning` 节点会在读取时兼容为 `workflow_graph`。新建、保存和 AI 生成都会使用 `workflow_graph` / `structure_graph`。

典型协作方式是：先用 Workflow Graph 决定项目要做什么；遇到需要具体管线、依赖或数据结构的步骤时，放入 Structure Graph；后续 code/task 节点再根据 Structure Graph 的结构输出进行实现、验证或交付。

## 目标用户

- 独立游戏开发者
- 使用 Claude Code、Cursor、Codex 等工具进行 AI 辅助编程的开发者
- 需要拆解复杂项目的产品/技术负责人
- 使用 AI 进行长期工程迭代的开发者
- 需要组织设定、资源、任务和 Agent 工作流的创作者

第一阶段优先服务 **AI 辅助软件/游戏项目规划与执行** 场景。

![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## 功能特性

- **可视化 DAG 画布** — 基于 @xyflow/react 的无限画布。拖拽、连接、配置节点。内置小地图、背景网格和缩放控制。
- **节点类型** — `workflow_graph`、`structure_graph`、`prompt`、`memory`、`filescope`、`project_scan`、`code_analysis`、`code`、`api`、`asset`、`agent`、`task`、`semantic`（`planning` 仅作为旧项目兼容）
- **AI 图生成** — 输入目标语句，AI 自动生成完整的 DAG 连接图
- **图展开** — Workflow Graph 展开为高层工作包；Structure Graph 展开为带端口的数据流 subgraph
- **Subgraph 导航** — Structure Graph 可以包含内部子节点，让细节管线和顶层工作流分开管理
- **代码分析与生成** — 只读项目扫描、Claude Code 驱动的代码分析，以及带 diff 追踪和 FileScope 约束的代码生成
- **模块图** — 代码分析结果可展开为可视化模块依赖图
- **逐节点上下文控制** — 三种模式：`inherit`（继承上游 + 内存）、`explicit`（仅节点字段）、`isolated`（无上游、无内存）
- **确认协议** — 节点在遇到阻塞时发出结构化 `mag-confirmation` 块，暂停 DAG 执行等待用户输入
- **DAG 执行** — 基于拓扑排序的顺序执行，通过 SSE 流式传输实时进度、日志和 Token 用量
- **多供应商支持** — Anthropic Claude、OpenAI、DeepSeek、本地 Claude CLI、本地 Codex CLI
- **项目持久化** — `.mag` 项目文件夹，包含 JSON 图、Markdown 内存和资源存储，完全兼容 Git
- **可调整面板** — 可折叠的左侧面板（项目浏览器）、底部面板（监视器）、右侧面板（节点检查器）
- **Markdown 输出查看器** — 全屏面板，支持原始文本和渲染 Markdown 预览模式

## 架构

```
┌─────────────────────────────────────────────────┐
│                  Tauri 2.x (Rust)                │
│              桌面壳 + sidecar 管理               │
├─────────────────────────────────────────────────┤
│   React 18 + TypeScript + @xyflow/react         │
│   Zustand (状态管理) + Tailwind CSS              │
│   react-resizable-panels                        │
├─────────────────────────────────────────────────┤
│   FastAPI (Python 3.11+)                        │
│   SSE 流式端点                                   │
│   AI 供应商: Anthropic / DeepSeek / CLI          │
├─────────────────────────────────────────────────┤
│   .mag 项目文件夹 (JSON + Markdown)              │
│   本地存储，Git 友好                              │
└─────────────────────────────────────────────────┘
```

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **Python** ≥ 3.11
- **uv**（Python 包管理器）— `pip install uv`
- **Rust**（仅 Tauri 桌面模式需要）

### 浏览器开发模式（推荐首选）

无需安装 Rust。一条命令同时启动前后端。

**一次性准备：**

```bash
# 前端依赖
cd frontend
npm install

# 后端依赖
cd ../backend
uv venv --python 3.13
uv pip install -e .
```

**启动：**

```bash
# 在项目根目录执行 — 同时启动后端 (端口 8765) 和前端 (端口 1420)
npm run dev
```

Windows 用户也可双击 `start-dev.bat`。

浏览器打开 `http://localhost:1420`。

**快速验证：**
1. 在顶部输入框中输入目标，例如"做一个 RPG 游戏的城市生成器"
2. 点击 **Generate** — 画布出现 5 个节点的 DAG
3. 点击任意节点，在右侧面板查看 type、contextMode、fileScope 等属性

> **注意：** 未配置 API Key 时，planner 会自动回退到离线 demo 图，UI 流程仍可完整演示。

### 配置 API Key

点击工具栏右侧的 ⚙ 齿轮图标，在设置面板中配置供应商密钥。Key 仅保存在浏览器 localStorage 中，不会写入 `.mag` 项目文件。

或通过环境变量配置：

| 供应商 | 环境变量 | 默认模型 |
|--------|---------|---------|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4.1` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` |

### Tauri 桌面模式

需要安装 Rust 和平台构建依赖（Windows 需要 Visual Studio Build Tools，macOS 需要 Xcode CLI tools）。

```bash
cd src-tauri
cargo tauri dev
```

详见 [doc/quickstart.md](doc/quickstart.md) 中各平台的详细安装步骤。

## 项目结构

```
MindAgentGraph/
├── frontend/              # React 前端 (Vite + TypeScript + Tailwind)
│   └── src/
│       ├── api/           # API 客户端 + SSE 流式处理
│       ├── components/    # Canvas、NodeInspector、Monitor、Settings 等
│       ├── store/         # Zustand 状态 (graph、keys、monitor、panels)
│       ├── hooks/         # useRunNode — 核心执行 hook
│       └── utils/         # 确认协议解析器
├── backend/               # FastAPI Python 后端
│   └── app/
│       ├── main.py        # FastAPI 应用 + SSE 端点
│       ├── services/      # Planner、Runner、DAG Executor、Code Runner
│       │   └── providers/ # Anthropic、DeepSeek、Local CLI 供应商
│       └── tests/
├── src-tauri/             # Tauri Rust 桌面壳
├── shared/                # 跨语言类型 + JSON Schema
├── doc/                   # 设计文档 + 快速开始指南
├── examples/              # Demo .mag 项目
└── scripts/               # 开发启动脚本
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri 2.x (Rust) |
| 前端 | React 18, TypeScript, @xyflow/react, Zustand, Tailwind CSS |
| 后端 | FastAPI (Python 3.11+), PyInstaller sidecar |
| AI 供应商 | Anthropic Claude SDK, OpenAI SDK, DeepSeek (兼容 OpenAI), 本地 CLI |
| 存储 | `.mag` 项目文件夹 (JSON + Markdown)，Git 友好 |
| 构建 | Vite, hatchling, Cargo, uv |

## 文档

- [快速开始指南](doc/quickstart.md) — 浏览器开发模式和 Tauri 桌面模式的详细配置
- [产品提案](doc/proposal.md) — 完整的产品愿景和设计理念
- [概要设计](doc/high-level-design.md) — MVP 架构文档
- [详细设计](doc/detailed-design.md) — 组件级设计规范

## 开源协议

[GNU Affero General Public License v3.0](LICENSE)
