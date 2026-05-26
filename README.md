# MindAgentGraph

<p align="center">
  <b>A node-based AI creation planning tool</b> for creators and developers who need to plan, decompose, and execute complex long-term projects.
</p>

<p align="center">
  <b>English</b> | <a href="README_zh.md">中文</a>
</p>

---

## What is MindAgentGraph?

MindAgentGraph is **not a chat AI**. It is a visual node system for organizing AI work context — think of it as a control panel where nodes, edges, context, memory, and file scope define the boundaries within which AI operates.

Instead of wrestling with a growing chat history, you build a **visual DAG of thinking nodes**. Each node is an independent unit of work with its own purpose, prompt, memory reference, file scope, dependencies, and execution output. Edges define upstream/downstream relationships and context inheritance. The graph is both your **project plan** and your **AI execution dashboard**.

## Why Not Just Chat?

Chat-based AI breaks down in complex projects:

- **Context gets messy.** Long conversations drift. There's no durable structure to revisit or refine a plan weeks later.
- **Scope bleeds.** AI sees too much of your project and touches files it shouldn't.
- **No visual overview.** Tasks, dependencies, memory, and results are scattered across chat turns with no bird's-eye view.
- **Multi-agent chaos.** When multiple agents or subtasks collaborate, there's no clear boundary, communication record, or scheduling mechanism.
- **Assets everywhere.** Code, designs, settings, and plans live in different tools with no unified structure.

MindAgentGraph replaces the "endless chat thread" with **structured node-based planning and execution**.

## Core Ideas

- A **node** is not a code block — it's an AI thinking structure: a task, module, agent, resource, or system component.
- AI works **within the current node's context** — it does not pollute the entire project.
- Nodes manage their own **prompt, memory, goal, file scope, dependencies, and output**.
- Edges represent **upstream dependency, context inheritance, or inter-agent communication**.
- The graph is both a **living project plan** and a **visual execution dashboard**.

## Graph Types

MindAgentGraph separates high-level workflow planning from detailed structural design:

- **Workflow Graph** (`workflow_graph`) is the high-level execution plan. It decomposes a goal into coarse work packages such as research, architecture, implementation, validation, and delivery. Workflow expansion uses normal planning logic and intentionally avoids port-level dataflow.
- **Structure Graph** (`structure_graph`) is a detailed dataflow or dependency graph. It is used for pipelines, module structures, asset flows, generation rules, and other cases where explicit inputs, outputs, and typed connections matter.
- **Lightweight subgraphs** keep Structure Graph internals inside the Structure Graph node. Double-click or enter a Structure Graph to inspect its internal nodes; the parent Workflow Graph stays clean and focused on orchestration.
- Legacy `planning` nodes are loaded as `workflow_graph` for compatibility. New graphs use `workflow_graph` and `structure_graph`.

A typical collaboration pattern is: use a Workflow Graph to decide what must happen, add a Structure Graph where a step needs a concrete pipeline or dependency model, then let downstream code/task nodes implement or validate that structure.

## Target Users

- Indie game developers
- AI-assisted programmers using Claude Code, Cursor, Codex, or similar tools
- Tech leads and product owners decomposing complex projects
- Developers iterating on long-term engineering projects with AI
- Creators organizing settings, assets, tasks, and agent workflows

The first phase focuses on **AI-assisted software and game project planning and execution**.

![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## Features

- **Visual DAG Canvas** — infinite canvas with @xyflow/react. Drag, connect, and configure nodes. MiniMap, background grid, and zoom controls included.
- **Node Types** - `workflow_graph`, `structure_graph`, `prompt`, `memory`, `filescope`, `project_scan`, `code_analysis`, `code`, `api`, `asset`, `agent`, `task`, `semantic` (`planning` is legacy-compatible)
- **AI Graph Generation** — input a goal sentence; AI generates a full DAG of connected nodes automatically
- **Graph Expansion** - Workflow Graph nodes expand into high-level work packages; Structure Graph nodes expand into port-based dataflow subgraphs
- **Subgraph Navigation** - Structure Graph nodes can contain internal child nodes, keeping detailed pipelines separate from the top-level workflow
- **Code Analysis & Generation** — read-only project scanning, Claude Code-powered analysis, and diff-tracked code generation with FileScope constraints
- **Module Graph** — code analysis results expand into a visual module dependency graph
- **Per-Node Context Control** — three modes: `inherit` (upstream + memory), `explicit` (node fields only), `isolated` (no upstream, no memory)
- **Confirmation Protocol** — nodes emit structured `mag-confirmation` blocks when blocked, pausing DAG execution for user input
- **DAG Execution** — sequential topological execution via SSE streaming with real-time progress, logs, and token usage
- **Multi-Provider Support** — Anthropic Claude, OpenAI, DeepSeek, local Claude CLI, and local Codex CLI
- **Project Persistence** — `.mag` project folders with JSON graphs, Markdown memory, and asset storage — fully Git-friendly
- **Resizable Panels** — collapsible left panel (project explorer), bottom panel (monitor), and right panel (node inspector)
- **Markdown Output Viewer** — full-screen panel with raw text and rendered Markdown preview modes

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Tauri 2.x (Rust)                │
│              Desktop shell + sidecar             │
├─────────────────────────────────────────────────┤
│   React 18 + TypeScript + @xyflow/react         │
│   Zustand (state) + Tailwind CSS                │
│   react-resizable-panels                        │
├─────────────────────────────────────────────────┤
│   FastAPI (Python 3.11+)                        │
│   SSE streaming endpoints                       │
│   AI providers: Anthropic / DeepSeek / CLI      │
├─────────────────────────────────────────────────┤
│   .mag project folders (JSON + Markdown)        │
│   Local storage, Git-friendly                   │
└─────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Python** ≥ 3.11
- **uv** (Python package manager) — `pip install uv`
- **Rust** (Tauri desktop mode only)

### Browser Dev Mode (Recommended First)

No Rust required. Runs backend + frontend with a single command.

**One-time setup:**

```bash
# Frontend dependencies
cd frontend
npm install

# Backend dependencies
cd ../backend
uv venv --python 3.13
uv pip install -e .
```

**Start:**

```bash
# From project root — starts both backend (port 8765) and frontend (port 1420)
npm run dev
```

Or double-click `start-dev.bat` on Windows.

Open `http://localhost:1420` in your browser.

**Quick test:**
1. Type a goal in the top input bar, e.g. "Design a city generator for an RPG game"
2. Click **Generate** — a 5-node DAG appears on the canvas
3. Click any node to inspect its type, context mode, file scope, and data in the right panel

> **Note:** Without an API key, the planner falls back to an offline demo graph. The full UI flow still works.

### Configure API Keys

Click the ⚙ gear icon in the toolbar to configure provider keys via the settings panel. Keys are stored in browser localStorage only — never in `.mag` project files.

Or set environment variables:

| Provider | Environment Variable | Default Model |
|----------|---------------------|---------------|
| Anthropic | `ANTHROPIC_API_KEY` | `claude-sonnet-4-6` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4.1` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-chat` |

### Tauri Desktop Mode

Requires Rust + platform build dependencies (Visual Studio Build Tools on Windows, Xcode CLI tools on macOS).

```bash
cd src-tauri
cargo tauri dev
```

See [doc/quickstart.md](doc/quickstart.md) for detailed platform-specific setup instructions.

## Project Structure

```
MindAgentGraph/
├── frontend/              # React frontend (Vite + TypeScript + Tailwind)
│   └── src/
│       ├── api/           # API client + SSE streaming
│       ├── components/    # Canvas, NodeInspector, Monitor, Settings, etc.
│       ├── store/         # Zustand stores (graph, keys, monitor, panels)
│       ├── hooks/         # useRunNode — core execution hook
│       └── utils/         # Confirmation protocol parser
├── backend/               # FastAPI Python backend
│   └── app/
│       ├── main.py        # FastAPI app + SSE endpoints
│       ├── services/      # Planner, Runner, DAG Executor, Code Runner
│       │   └── providers/ # Anthropic, DeepSeek, Local CLI providers
│       └── tests/
├── src-tauri/             # Tauri Rust desktop shell
├── shared/                # Cross-language types + JSON Schema
├── doc/                   # Design documents + quickstart guide
├── examples/              # Demo .mag project
└── scripts/               # Dev launcher scripts
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Tauri 2.x (Rust) |
| Frontend | React 18, TypeScript, @xyflow/react, Zustand, Tailwind CSS |
| Backend | FastAPI (Python 3.11+), PyInstaller sidecar |
| AI Providers | Anthropic Claude SDK, OpenAI SDK, DeepSeek (OpenAI-compatible), local CLI |
| Storage | `.mag` project folders (JSON + Markdown), Git-friendly |
| Build | Vite, hatchling, Cargo, uv |

## Documentation

- [Quickstart Guide](doc/quickstart.md) — detailed setup for browser dev mode and Tauri desktop mode
- [Product Proposal](doc/proposal.md) — full product vision and design rationale
- [High-Level Design](doc/high-level-design.md) — MVP architecture document
- [Detailed Design](doc/detailed-design.md) — component-level design specifications

## License

[GNU Affero General Public License v3.0](LICENSE)
