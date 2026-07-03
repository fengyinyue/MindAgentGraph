# MindAgentGraph Proposal: ComfyUI-Style AI Engineering Workflow

## 1. 背景

MindAgentGraph 不应该只是把 Claude Code、Codex、Cursor 这类 AI 编程工具拆成多个聊天节点。  
如果每个节点都只是一次独立的 Agent 调用，那么画布会变成“多个聊天框的可视化版本”，节点系统本身的价值会很弱。

更有价值的方向是参考 ComfyUI 的工作流模式：

```text
节点不是一个个会聊天的 Agent，而是输入输出明确、可组合、可复用的工程算子。
```

MindAgentGraph 的目标应该是成为：

```text
面向 AI 软件工程的可视化工作流编排工具。
```

它的核心价值不是单次生成更多代码，而是把常见 AI 工程过程沉淀成可复用、可检查、可组合的工作流。

## 2. 产品定位

MindAgentGraph 应该帮助用户把一次软件工程任务拆成稳定流程：

```text
Requirement -> Analysis -> Design -> File Scope -> Execution -> Test -> Review
```

每个阶段都有明确职责：

- `Requirement`：保存任务描述、约束和验收目标。
- `Analysis`：只读分析项目结构、关键文件、风险点和上下文。
- `Design`：生成结构化设计说明，而不是直接生成执行节点。
- `File Scope`：定义允许修改和禁止修改的文件范围。
- `Execution`：在受控文件范围内执行真实代码修改。
- `Test`：运行白名单测试或构建命令，产出可复查结果。
- `Review`：读取上游设计、修改和测试结果，给出通过或修复建议。

这个流程可以保存成模板，在不同项目和任务中复用。

## 3. 与 Claude Code / Codex 的区别

Claude Code 和 Codex 擅长在一次上下文里完成复杂任务，但它们的流程通常存在于聊天记录中：

- 分析、设计、执行、测试、Review 容易混在一起。
- 中间产物不够结构化。
- 成功经验不容易保存为可复用流程。
- 每次任务都需要重新组织上下文。
- 很难把“这个项目的稳定做法”沉淀成模板。

MindAgentGraph 不需要替代这些工具，而是应该把它们变成工作流中的执行引擎之一。

换句话说：

```text
Claude Code / Codex 解决“这次怎么做”。
MindAgentGraph 解决“这类任务以后都怎么做”。
```

## 4. 核心原则

### 4.1 节点是算子，不是模块

Planning 或 Design 生成的“模块图”不应该直接等价于一组 Execution 节点。

例如：

```text
UI 模块、状态模块、测试模块
```

这些更像设计图中的系统模块，而不是一个个可执行步骤。  
Execution 节点应该代表一次可验证的修改批次，而不是一个抽象模块。

更合理的关系是：

```text
模块图帮助理解系统结构。
Execution 节点执行一个可验证的工程改动。
```

### 4.2 节点必须有明确输入输出

每个节点都应该回答：

- 它读取什么输入？
- 它产出什么结果？
- 下游节点如何消费它？
- 它是否会修改项目文件？
- 它的结果是否可以被缓存、编辑和复用？

节点输出不应该只是聊天文本，而应该逐步结构化。

### 4.3 工作流模板优先于 Tool Trace 复用

当前 `Replay` 和 `Save as Skill` 更像保存某次 Execution 的工具调用轨迹。  
这对调试有价值，但层级太低，更像“录屏宏”。

真正应该优先复用的是完整工程流程：

```text
Requirement -> Analysis -> Design -> File Scope -> Execution -> Test -> Review
```

未来应从 `Save as Skill` 演进为：

```text
Save Workflow Template
```

模板保存的是节点图、输入输出契约、默认参数和运行策略，而不是某一次具体工具调用序列。

### 4.4 中间产物必须可见、可编辑、可传递

每个阶段都应该留下清晰产物：

- Analysis 输出项目结构、关键文件、风险点。
- Design 输出设计图、实施步骤、验收标准、文件范围建议。
- File Scope 输出 allow / deny 路径。
- Execution 输出修改摘要、changed files、diff、后续建议。
- Test 输出命令、退出码、stdout、stderr。
- Review 输出结论、问题列表、修复建议和证据。

用户可以编辑这些产物，再让下游节点继续执行。

## 5. 推荐节点语义

### 5.1 Requirement

Requirement 是任务源头。  
它不应该要求用户必须先运行一次才对下游可见。

后续实现应保证：

```text
Requirement 的 title / purpose / output 都可以作为下游上下文。
```

这样用户只要在 Requirement 写任务描述，Analysis 和 Design 就能直接读取。

### 5.2 Analysis

Analysis 是只读代码分析节点。  
它应该使用 Execution 节点的只读模式：

- 可以读取文件。
- 可以 grep / inspect project。
- 不允许写文件。
- 不允许运行会修改项目的工具。

Analysis 的输出应该帮助后续 Design 和 Execution 理解项目，而不是直接修改代码。

### 5.3 Design

Design 由原来的 Planning 节点演化而来。  
它的核心动作是 `Generate Design`。

`Generate Design` 不生成单独文件，也不自动生成外部节点。  
它生成的是 Design 节点自己的结构化输出，供下游读取。

推荐输出结构：

```text
Goal
Design Graph
Implementation Steps
Recommended File Scope
Acceptance Criteria
Execution Notes
```

Design 的目标是产出施工图，而不是替用户直接拆一堆执行器。

### 5.4 File Scope

File Scope 节点用于固化文件权限范围。

推荐连接：

```text
Design -> File Scope -> Execution
```

它应该产出：

```text
allow:
- src/**
- backend/app/services/code_runner.py

deny:
- .env
- node_modules/**
- dist/**
```

当前版本中，Execution 还不会自动读取上游 File Scope。  
短期需要把 File Scope 内容手动填到 Execution 节点的 fileScope。  
后续应支持 Execution 自动合并上游 File Scope。

### 5.5 Execution

Execution 是真实代码执行节点。  
它负责在项目目录和文件范围约束下修改代码。

Execution 不应该对应“一个设计模块”，而应该对应“一次可验证的修改批次”。

例如：

```text
Execution 1: 实现数据结构
Execution 2: 接入 UI
Execution 3: 补测试并修复失败
```

每个 Execution 都应该有清楚的输入、输出和验收方式。

### 5.6 Task

Task 是当前 Phase 1 的通用动作节点，用来承接 Test 和 Review。

短期通过 `workflowRole` 区分：

```text
workflowRole = test
workflowRole = review
```

Test Task 的原理是：

```text
读取 Test Command
检查命令是否在白名单中
调用 /run/tool-sequence
在 Project Dir 下执行命令
把 exit code / stdout / stderr 写回节点
```

Review Task 会读取上游 Design、Execution 和 Test 结果，生成：

```text
Verdict
Findings
Required Fixes
Evidence
```

长期应考虑把 Task 拆成更明确的节点：

```text
Test
Review
Approval
Report
Publish
```

## 6. Run DAG 的目标形态

当前 Run DAG 更接近“批量文本节点执行”。  
它还没有真正支持任意节点的真实语义执行。

理想的 Run DAG 应该是一个节点调度器：

```text
Requirement -> 普通文本输入或直接透传
Analysis    -> 只读 Native Runner
Design      -> Generate Design
File Scope  -> 解析或生成 allow / deny
Execution   -> Native Code Runner
Test        -> Tool Sequence
Review      -> Review Prompt
```

这意味着 Run DAG 不能再对所有节点使用同一个 runner。  
它必须根据节点类型和 workflowRole 选择不同执行器。

## 7. Phase 1 范围

Phase 1 的目标是建立最小可用的工程工作流骨架。

已完成或应完成的内容：

- 顶层节点列表支持 `Requirement / Analysis / Design / File Scope / Execution / Task`。
- UI 中把 Code 改名为 Execution。
- Analysis 使用 Execution 的只读模式。
- Design 提供 `Generate Design`。
- Planning 的外部执行节点生成功能默认关闭。
- Task 支持 `test` 和 `review` 角色。
- Test Task 使用白名单命令运行。
- Review Task 读取上游输出并生成评审结果。

Phase 1 的成功标准：

```text
用户可以手动搭出 Requirement -> Analysis -> Design -> Execution -> Test -> Review，
并且每个节点的产物能被下游节点读取。
```

## 8. Phase 1.1 建议

Phase 1.1 应该补齐当前最影响体验的上下文传递问题。

建议优先级：

1. Requirement 的 purpose 自动传给下游。
2. Execution 自动读取上游 File Scope。
3. Run DAG 根据节点类型选择 runner。
4. Test Task 支持节点级 working directory。
5. File Scope 支持从 Design 输出中一键提取 allow / deny。
6. Design 输出可以选择保存为项目文档。

## 9. Phase 2 建议

Phase 2 应该围绕工作流模板展开：

- `Save Workflow Template`
- `Load Workflow Template`
- 模板参数化
- 节点输入输出契约
- 模板运行前检查
- 工作流运行报告
- 成功工作流版本管理

模板不应该只是保存画布布局，而应该保存可复用工程方法。

## 10. 关键设计判断

MindAgentGraph 的长期价值不在于“比 Claude Code 更会写代码”。  
它的价值在于把 AI 工程过程变成可见、可编辑、可复用、可运行的工作流。

因此产品设计应该持续围绕这个判断收敛：

```text
不要把节点做成多个聊天 Agent。
要把节点做成可组合的工程算子。
```

当一个功能无法提高工作流复用、上下文传递、产物可见性或执行可控性时，就应该谨慎加入。

