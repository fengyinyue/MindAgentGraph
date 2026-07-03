# MindAgentGraph

<p align="center">
  <b>面向 AI 工程工作流的可视化节点编排工具</b>
</p>

<p align="center">
  <a href="README.md">English</a> | <b>中文</b>
</p>

---

## 这是什么

MindAgentGraph 不是另一个聊天窗口，也不是把 Claude Code、Codex、Cursor 之类的工具简单包装成多个 Agent。

它的目标是把常见的 AI 工程流程沉淀成可视化、可复用、可审计的工作流：

```text
Requirement -> Analysis -> Design -> File Scope -> Execution -> Test -> Review
```

你可以像搭 ComfyUI 工作流一样，把一次软件开发任务拆成多个节点。每个节点都有明确的输入、输出、职责、系统提示词、文件作用域和运行结果。连线不是装饰，而是表示上游产物如何传递给下游节点。

核心价值不是“多开几个 AI”，而是让 AI 工作过程从一次性聊天变成稳定的工程流程。

## 为什么需要它

单纯用聊天式 AI 做复杂项目时，常见问题是：

- 上下文越来越长，任务边界变模糊。
- 分析、设计、实现、测试、Review 混在一起，难以复用。
- 成功的一次经验很难沉淀成下次可运行的流程。
- AI 容易读取或修改不该动的文件。
- 中间产物散落在聊天记录里，后续节点无法稳定消费。

MindAgentGraph 的做法是把这些过程拆成节点，让每一步都有可见产物，并且可以被下游节点继续使用。

## 核心理念

- **节点是工作流算子，不是聊天 Agent。** 节点应该有清晰的输入和输出。
- **连线表达数据流。** 上游节点的结构化输出可以绑定到下游节点的输入参数。
- **中间产物可见、可编辑、可复用。** Analysis、Design、Execution、Test、Review 都应该留下清晰结果。
- **执行节点保持少而准。** Execution 节点负责实际修改文件；设计图里的每个模块不应该自动变成一个执行器。
- **工作流比工具轨迹更值得复用。** 未来更重要的是保存 Workflow Template，而不是只保存某一次工具调用轨迹。

## 推荐工作流

```text
Requirement
  -> Analysis
  -> Design
  -> File Scope
  -> Execution
  -> Test
  -> Review
```

每个阶段的职责：

| 节点 | 职责 | 典型输出 |
| --- | --- | --- |
| Requirement | 记录需求、目标、约束和验收标准 | 结构化需求说明 |
| Analysis | 只读分析项目，不修改文件 | 相关文件、现状、风险、建议入口 |
| Design | 生成设计方案或内容规划 | Markdown、Mermaid、实施步骤、验收标准 |
| File Scope | 限定可读写文件范围 | allow / deny 路径规则 |
| Execution | 执行代码或文件修改 | 修改摘要、changed files、diff、运行记录 |
| Test | 运行确定性的测试命令 | test report、stdout、stderr、失败原因 |
| Review | 审查结果、风险和遗漏 | 问题清单、修复建议、是否通过 |

## 节点类型

当前常用节点类型包括：

- `planning`：高层规划节点，用于组织流程和拆解目标。
- `subgraph`：内部子图，用于表达更细的依赖、管线或结构。
- `prompt`：普通提示词节点，用于生成文本产物。
- `memory`：长期上下文或知识记录。
- `filescope`：文件作用域节点，约束 Execution 可触碰的路径。
- `analysis`：只读分析节点，可以读取项目但不修改文件。
- `design`：设计产物节点，适合生成方案、图表、文档和规格。
- `code`：执行节点，界面中可显示为 Execution，负责真实读写文件和运行白名单命令。
- `test`：测试节点，负责运行测试命令并输出测试报告。
- `task`：普通任务节点，适合作为人工检查点、说明、总结或流程占位。
- `tool`：工具节点，用于表达可物化的工具调用。
- `asset` / `api` / `agent` / `semantic`：用于更具体的资源、接口、代理或语义组织场景。

## 数据流和上下文

MindAgentGraph 支持节点端口和上下文模式：

- 节点可以手动编辑 `inputs` / `outputs`。
- `sourceHandle` 对应上游结构化输出字段。
- `targetHandle` 对应下游输入参数。
- Runner 会按照端口绑定构造当前节点上下文。
- 节点默认只读取直接输入的数据，避免递归读取造成重复上下文。

这让工作流更接近真正的数据管线，而不是“把所有上游聊天记录都塞给模型”。

## 执行模型

Execution 节点使用原生代码 runner：

- 根据 File Scope 限定文件读写范围。
- 支持 `list_files`、`read_file`、`grep`、`apply_patch`、`write_file`、`move_file`、`delete_file`、`mkdir`、`inspect_project`、`run_command`、`get_diff` 等工具。
- `run_command` 使用白名单，避免任意命令执行。
- 每次运行都会记录工具调用、变更文件和 diff。
- Analysis 节点使用只读模式，适合在执行前理解项目。

Test 节点负责运行确定性的测试命令，例如：

```bash
uv run pytest
python -m pytest
npm test
```

推荐做法是：Execution 负责实现，Test 负责验证，Review 负责判断风险和是否需要下一轮修复。

## 示例项目

仓库内包含 `.mag` 示例工作流：

- `examples/python-dev.mag`：Python 开发流程示例。
- `examples/character-design.mag`：角色设计流程示例。
- `examples/novel-writing.mag`：小说写作流程示例。

这些示例用于验证节点数据流、系统提示词、输入输出面板和 DAG 执行方式。

## 快速开始

### 环境要求

- Node.js 18+
- Python 3.11+
- uv
- Rust，仅 Tauri 桌面模式需要

### 安装依赖

```bash
cd frontend
npm install

cd ../backend
uv venv --python 3.13
uv pip install -e .
```

### 浏览器开发模式

在项目根目录执行：

```bash
npm run dev
```

它会同时启动：

- 后端 FastAPI：`http://localhost:8765`
- 前端 Vite：`http://localhost:1420`

Windows 用户也可以双击：

```text
start-dev.bat
```

### Tauri 桌面模式

```bash
cd src-tauri
cargo tauri dev
```

更详细的环境配置见 [doc/quickstart.md](doc/quickstart.md)。

## API Key 配置

可以在界面设置面板里配置模型供应商密钥。密钥保存在浏览器 `localStorage`，不会写入 `.mag` 项目文件。

也可以通过环境变量配置：

| 供应商 | 环境变量 |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

## 项目结构

```text
MindAgentGraph/
|-- frontend/      React + TypeScript + @xyflow/react 前端
|-- backend/       FastAPI 后端和节点 runner
|-- shared/        跨前后端共享类型和 JSON Schema
|-- src-tauri/     Tauri 桌面壳
|-- examples/      示例 .mag 项目
|-- doc/           产品、设计和快速开始文档
|-- scripts/       开发启动脚本
```

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端 | React 18、TypeScript、Vite、@xyflow/react、Zustand、Tailwind CSS |
| 后端 | FastAPI、Python、Pydantic、SSE |
| 桌面 | Tauri 2.x |
| AI Provider | Anthropic、OpenAI、DeepSeek、本地 Claude CLI、本地 Codex CLI |
| 存储 | `.mag` 项目文件夹，JSON + Markdown，Git 友好 |
| 构建 | npm、uv、Cargo |

## 文档

- [快速开始](doc/quickstart.md)
- [产品提案](doc/proposal.md)
- [ComfyUI 风格 AI 工作流规划](doc/comfyui-style-ai-workflow-plan.md)

## 当前阶段

当前重点是打通一个可复用的 AI 工程闭环：

```text
Requirement -> Analysis -> Design -> Execution -> Test -> Review
```

短期目标：

- 明确节点职责，减少 `task`、`test`、`code` 的语义混乱。
- 让端口真正参与数据传递。
- 改进输入面板、输出面板和系统提示词编辑体验。
- 让示例工作流可以作为模板复用。
- 逐步把 `Save as Skill` 升级为 `Save Workflow Template`。

## License

[GNU Affero General Public License v3.0](LICENSE)
