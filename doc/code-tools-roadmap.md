# Code Tools Roadmap

本文档记录 `code` 节点原生工具体系的当前状态和后续待做工具。目标是让 `code` 节点从“能读写文件”逐步升级为“能理解项目、执行验证、辅助重构，并把工具调用物化为可编辑的内部节点”。

## 当前已实现

### 文件探索

- `list_files`：按路径和 pattern 列出项目文件。
- `read_file`：读取项目内文本文件。
- `grep`：在项目文件中做文本或正则搜索。
- `inspect_project`：识别项目根目录文件、语言、包管理器、`package.json` scripts、建议验证命令和当前允许的命令白名单。

### 文件修改

- `apply_patch`：对单个文件做唯一文本替换，也可在 `oldText` 为空时创建新文件。
- `write_file`：新建文件或覆盖已有文件，覆盖需要 `overwrite=true`。
- `delete_file`：删除文件，需要 `confirm=true`。
- `move_file`：移动或重命名文件。
- `mkdir`：创建目录。

### 验证与收尾

- `run_command`：白名单命令执行，不走 shell，只能在 `projectDir` 内运行。
- `get_diff`：捕获本次 code run 的变更文件和 diff。
- `finish`：结束本次 code run 并输出摘要。
- `value`：前端内部常量/参数节点，用于把字面值接到其他 tool 节点输入端口。

当前 `run_command` 白名单：

```txt
npm run build
npm test
npm run test
pytest
python -m pytest
uv run pytest
ruff check
ruff format --check
tsc --noEmit
```

## 待做工具

### Phase 1：验证闭环增强

优先级最高。目标是让 code 节点能更稳定地判断“改完了吗、有没有坏”。

#### `run_tests`

更安全的测试封装，不直接暴露命令字符串。

建议参数：

- `target`：`all` / `backend` / `frontend` / `current`
- `framework`：可选，`pytest` / `vitest` / `jest` / `auto`
- `path`：可选，测试文件或目录
- `timeoutSeconds`

输出：

- `exitCode`
- `passed`
- `failed`
- `stdout`
- `stderr`
- `summary`

实现建议：

- 第一版基于 `inspect_project` 和白名单命令映射。
- 不允许模型传任意命令。
- 若项目无法识别测试命令，返回需要用户配置，而不是猜测执行。

#### `check_diagnostics`

统一收集类型检查、lint、构建错误摘要。

建议参数：

- `kind`：`typecheck` / `lint` / `build` / `auto`
- `path`：可选，限定文件或目录
- `timeoutSeconds`

输出：

- `ok`
- `diagnostics`
- `stdout`
- `stderr`
- `summary`

实现建议：

- 第一版调用白名单命令，如 `tsc --noEmit`、`ruff check`、`npm run build`。
- 后续可接 TypeScript language service、Python LSP、eslint JSON 输出。

#### `format_file`

格式化指定文件。

建议参数：

- `path`
- `formatter`：`auto` / `prettier` / `ruff` / `black`
- `checkOnly`

输出：

- `path`
- `formatted`
- `changed`
- `stdout`
- `stderr`

实现建议：

- 只允许 FileScope 内文件。
- 第一版只做 `checkOnly` 或白名单 formatter。
- 写入型格式化需要进入 trace，并纳入 diff。

### Phase 2：代码理解增强

目标是减少整文件读取和盲目 grep，让 code 节点能按“符号”理解项目。

#### `list_symbols`

列出文件中的函数、类、接口、导出项。

建议参数：

- `path`
- `symbolTypes`：可选，例如 `function` / `class` / `interface` / `export`

输出：

- `symbols`
- `language`
- `parser`

实现建议：

- 第一版可以用轻量正则实现 TypeScript/Python。
- 稳定后接 tree-sitter。

#### `read_definition`

读取某个 symbol 的定义代码块。

建议参数：

- `path`
- `symbol`
- `kind`：可选

输出：

- `path`
- `symbol`
- `startLine`
- `endLine`
- `content`

实现建议：

- 依赖 `list_symbols` 的定位结果。
- 找不到时返回候选项，不直接猜。

#### `find_references`

查找函数、类、变量引用。

建议参数：

- `symbol`
- `path`
- `kind`
- `limit`

输出：

- `references`
- `truncated`

实现建议：

- 第一版可封装 `grep`。
- 后续接 LSP 或 tree-sitter query。

#### `read_related_files`

根据入口文件读取相关文件，例如 import、export、同名测试文件。

建议参数：

- `path`
- `depth`
- `includeTests`
- `limit`

输出：

- `files`
- `edges`
- `truncated`

实现建议：

- 第一版解析 import/require/from。
- 后续可复用 module graph。

### Phase 3：Diff / Git 工作流

目标是让用户更细粒度地检查、拆分和回退改动。

#### `get_file_diff`

查看指定文件 diff。

建议参数：

- `path`

输出：

- `path`
- `diff`
- `truncated`
- `warnings`

#### `summarize_changes`

总结当前变更、测试结果和风险。

建议参数：

- `includeDiff`
- `includeTests`

输出：

- `changedFiles`
- `summary`
- `risks`
- `testResults`

#### `revert_file`

恢复某个文件到本次运行前状态。

建议参数：

- `path`
- `confirm`

输出：

- `path`
- `reverted`
- `affectedFiles`

安全约束：

- 必须 `confirm=true`。
- 只允许恢复 code run marker 之后本次工具改过的文件。
- 不使用 `git checkout` 直接覆盖用户运行前已有改动。

#### `stage_patch`

暂存指定文件或 patch。

建议参数：

- `paths`
- `confirm`

输出：

- `stagedFiles`
- `stdout`
- `stderr`

备注：

- 该工具与 Git 状态强绑定，建议后置。
- 第一版可以不做，避免工具直接影响用户 Git 暂存区。

### Phase 4：配置与环境

目标是让项目级工具配置可被明确管理，而不是靠模型猜。

#### `read_tool_config`

读取项目内 MAG code tool 配置。

建议配置文件：

- `.mag/code-tools.json`
- 或 `.mag_code_tools.json`

输出：

- `allowedCommands`
- `testCommands`
- `formatCommands`
- `diagnosticCommands`

#### `suggest_tool_config`

根据 `inspect_project` 结果生成建议配置，但不自动写入。

输出：

- `config`
- `explanation`

#### `update_tool_config`

写入或更新 MAG code tool 配置。

安全约束：

- 需要用户确认。
- 不允许写入任意 shell 命令，只能写命令模板或白名单扩展。

### Phase 5：内部工具节点编排

目标是让 code 节点内部的 tool 子图不只是 trace，而是可以被用户创建、编辑、连接和重放。

#### `create_tool_node`

在当前 code 节点内部创建一个工具节点。

建议参数：

- `tool`
- `title`
- `input`
- `position`

输出：

- `nodeId`
- `tool`

#### `connect_tool_nodes`

连接两个内部 tool 节点端口。

建议参数：

- `sourceNodeId`
- `sourcePort`
- `targetNodeId`
- `targetPort`

输出：

- `edgeId`

#### `run_tool_node`

执行某个内部 tool 节点，并把结果写回该节点 output。

建议参数：

- `nodeId`

输出：

- `nodeId`
- `status`
- `output`
- `affectedFiles`

#### `promote_tool_node`

把内部 tool 节点提升为主图节点。

建议参数：

- `nodeId`
- `targetParentId`

输出：

- `promotedNodeId`

## 推荐实现顺序

1. `run_tests`
2. `check_diagnostics`
3. `format_file`
4. `list_symbols`
5. `read_definition`
6. `find_references`
7. `get_file_diff`
8. `summarize_changes`
9. `read_related_files`
10. `revert_file`
11. `read_tool_config`
12. `suggest_tool_config`
13. `update_tool_config`
14. `create_tool_node`
15. `connect_tool_nodes`
16. `run_tool_node`
17. `promote_tool_node`

## 通用安全规则

- 所有文件路径必须限制在 `projectDir` 内。
- 所有文件读写必须经过 FileScope allow/deny 检查。
- 写文件工具必须进入 Tool Trace，并记录 `affectedFiles`。
- 删除、回退、暂存等高风险工具必须要求显式确认。
- 命令执行必须走白名单，不走 shell，不允许管道、重定向、命令拼接。
- 默认命令超时 60 秒，最大超时 120 秒。
- stdout/stderr 和大型文件内容必须截断。
- 工具失败时返回结构化错误，不让模型伪造成功。
- 后续若支持项目级白名单，必须让用户明确审核配置。

