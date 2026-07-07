# MindAgentGraph

<p align="center">
  <b>A visual node orchestration tool for AI engineering workflows</b>
</p>

<p align="center">
  <b>English</b> | <a href="README_zh.md">中文</a>
</p>

---

## What is This

MindAgentGraph is not another chat window, nor a simple wrapper that spawns multiple agents from tools like Claude Code, Codex, or Cursor.

Its goal is to crystallize common AI engineering processes into visual, reusable, and auditable workflows:

```text
Requirement -> Analysis -> Design -> File Scope -> Execution -> Test -> Review
```

You can break down a software development task into multiple nodes — just like building a ComfyUI workflow. Each node has a clear input, output, responsibility, system prompt, file scope, and execution result. Edges are not decoration; they define how upstream artifacts are passed to downstream nodes.

The core value is not "running more AIs in parallel" — it's turning AI work from one-off chats into stable engineering processes.

## Why You Need It

Common problems when using chat-based AI for complex projects:

- Context grows endlessly and task boundaries become fuzzy.
- Analysis, design, implementation, testing, and review are all mixed together and hard to reuse.
- A successful run is hard to crystallize into a replayable process for next time.
- AI easily reads or modifies files it shouldn't touch.
- Intermediate artifacts are scattered across chat history and can't be reliably consumed by downstream steps.

MindAgentGraph breaks these processes into nodes, gives every step a visible artifact, and lets downstream nodes consume it.

## Core Ideas

- **Nodes are workflow operators, not chat agents.** Nodes should have clear inputs and outputs.
- **Edges express data flow.** Structured output from an upstream node can be bound to input parameters of a downstream node.
- **Intermediate artifacts are visible, editable, and reusable.** Analysis, Design, Execution, Test, and Review should all leave clear results.
- **Keep execution nodes few and precise.** Execution nodes are responsible for actually modifying files; every module in a design diagram should not automatically become an executor.
- **Workflows are more worth reusing than tool traces.** What matters most going forward is saving Workflow Templates, not just saving a single tool call trace.

## Recommended Workflow

```text
Requirement
  -> Analysis
  -> Design
  -> File Scope
  -> Execution
  -> Test
  -> Review
```

Responsibilities at each stage:

| Node | Responsibility | Typical Output |
| --- | --- | --- |
| Requirement | Record requirements, goals, constraints, and acceptance criteria | Structured requirement spec |
| Analysis | Read-only analysis of the project, no file modifications | Relevant files, current state, risks, suggested entry points |
| Design | Generate design plans or content outlines | Markdown, Mermaid, implementation steps, acceptance criteria |
| File Scope | Limit the set of readable/writable files | allow / deny path rules |
| Execution | Execute code or file modifications, choose Native Tools or Claude Code | Modification summary, changed files, diff, tool trace, run record |
| Test | Run deterministic test commands | test report, stdout, stderr, failure reasons |
| Review | Audit results, risks, and omissions | Issue list, fix suggestions, pass/fail verdict |

## Node Types

Commonly used node types:

- `planning`: High-level planning node for organizing processes and decomposing goals.
- `subgraph`: Internal subgraph for expressing finer dependencies, pipelines, or structures.
- `prompt`: Plain prompt node for generating text artifacts.
- `memory`: Long-term context or knowledge records.
- `filescope`: File scope node that constrains the paths an Execution node can touch.
- `analysis`: Read-only analysis node that can read the project but not modify files.
- `design`: Design artifact node, suited for generating plans, diagrams, documents, and specs.
- `code`: Execution node (displayed as Execution in the UI), responsible for actually reading/writing files and running verification commands. Currently supports `Native Tools` and `Claude Code` execution engines.
- `test`: Test node that runs test commands and outputs a test report.
- `task`: General task node, suitable as a manual checkpoint, note, summary, or process placeholder.
- `tool`: Tool node for expressing materializable tool calls.
- `asset` / `api` / `agent` / `semantic`: For more specific resource, interface, agent, or semantic organization scenarios.

## Data Flow and Context

MindAgentGraph supports node ports and context modes:

- Nodes can manually edit `inputs` / `outputs`.
- `sourceHandle` corresponds to structured output fields of the upstream node.
- `targetHandle` corresponds to input parameters of the downstream node.
- The runner builds the current node's context according to port bindings.
- Nodes only read directly bound input data by default, avoiding duplicate context from recursive upstream reads.

This makes workflows behave more like a real data pipeline, rather than "stuffing all upstream chat history into the model."

## Execution Model

Execution nodes can select an execution engine in the UI.

### Native Tools

`Native Tools` is MindAgentGraph's built-in controlled executor:

- Enforces file read/write boundaries according to File Scope.
- Supports tools: `list_files`, `read_file`, `grep`, `apply_patch`, `write_file`, `move_file`, `delete_file`, `mkdir`, `inspect_project`, `run_command`, `get_diff`, and more.
- `run_command` uses an allowlist to prevent arbitrary command execution.
- Every run records tool calls, changed files, and diffs.
- Best suited for scenarios requiring strict file scoping and replayable tool traces.

### Claude Code

The `Claude Code` engine calls the Claude Code CLI installed and logged in on the local machine:

- Uses `claude --print --no-session-persistence --output-format stream-json --verbose` by default.
- Displays Claude Code's execution progress in real time via structured events — e.g., `Read`, `Edit`, `Bash`, `Grep` tool calls.
- Tool events are converted into MindAgentGraph Tool Traces and materialized as viewable tool sub-nodes inside the Execution node.
- Changed files and diffs are still captured after the run ends.
- File Scope is written into the prompt, and the run checks afterward whether any files outside allow / deny were modified. Note: unlike Native Tools, it does not intercept at the tool layer.
- Override the Claude Code command via `MAG_CLAUDE_CODE_CMD`, for example to specify custom arguments or an executable path.

Analysis nodes currently use read-only mode, suited for understanding the project before execution; they can be extended to a read-only Claude Code analysis engine later.

Test nodes run deterministic test commands, for example:

```bash
uv run pytest
python -m pytest
npm test
```

The recommended pattern: Execution handles implementation, Test handles verification, Review judges risk and whether another round of fixes is needed.

## Example Projects

The repository includes `.mag` example workflows:

- `examples/python-dev.mag`: Python development workflow example.
- `examples/character-design.mag`: Character design workflow example.
- `examples/novel-writing.mag`: Novel writing workflow example.

These examples are used to verify node data flow, system prompts, input/output panels, and DAG execution.

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- uv
- Rust — required only for Tauri desktop mode
- Optional: Claude Code CLI (required when an Execution node selects the `Claude Code` engine)

### Install Dependencies

```bash
cd frontend
npm install

cd ../backend
uv venv --python 3.13
uv pip install -e .
```

### Browser Dev Mode

From the project root:

```bash
npm run dev
```

This starts both:

- Backend FastAPI: `http://localhost:8765`
- Frontend Vite: `http://localhost:1420`

Windows users can also double-click:

```text
start-dev.bat
```

### Tauri Desktop Mode

```bash
cd src-tauri
cargo tauri dev
```

For detailed environment setup see [doc/quickstart.md](doc/quickstart.md).

## API Key Configuration

Configure model provider keys in the settings panel in the UI. Keys are saved in browser `localStorage` and are never written to `.mag` project files.

You can also configure via environment variables:

| Provider | Environment Variable |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |

Local Claude Code does not need an API key configured in MindAgentGraph, but `claude` / `claude.cmd` must be executable on the system. If Claude Code is not in PATH, override the command via environment variable:

| Purpose | Environment Variable |
| --- | --- |
| Claude Code execution engine command | `MAG_CLAUDE_CODE_CMD` |
| Local Claude CLI general command | `MAG_LOCAL_CLAUDE_CMD` |

## Project Structure

```text
MindAgentGraph/
|-- frontend/      React + TypeScript + @xyflow/react frontend
|-- backend/       FastAPI backend and node runner
|-- shared/        Cross-language types and JSON Schema
|-- src-tauri/     Tauri desktop shell
|-- examples/      Sample .mag projects
|-- doc/           Product, design, and quickstart docs
|-- scripts/       Dev launcher scripts
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, @xyflow/react, Zustand, Tailwind CSS |
| Backend | FastAPI, Python, Pydantic, SSE |
| Desktop | Tauri 2.x |
| AI Provider | Anthropic, OpenAI, DeepSeek, local Claude CLI, local Codex CLI |
| Storage | `.mag` project folders, JSON + Markdown, Git-friendly |
| Build | npm, uv, Cargo |

## Documentation

- [Quickstart](doc/quickstart.md)
- [Product Proposal](doc/proposal.md)
- [ComfyUI-style AI Workflow Plan](doc/comfyui-style-ai-workflow-plan.md)

## Current Phase

The current focus is completing a reusable AI engineering loop:

```text
Requirement -> Analysis -> Design -> Execution -> Test -> Review
```

Near-term goals:

- Clarify node responsibilities and reduce semantic confusion among `task`, `test`, and `code`.
- Make ports actually participate in data passing.
- Improve the input panel, output panel, and system prompt editing experience.
- Make example workflows reusable as templates.
- Gradually upgrade `Save as Skill` to `Save Workflow Template`.

## License

[GNU Affero General Public License v3.0](LICENSE)
