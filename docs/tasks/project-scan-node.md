# Project Scan 节点任务

## 目标

让已有项目开发进入 Code 节点前，先通过只读扫描沉淀工程上下文。该节点回答“这个项目现在是什么样”，并把摘要作为后续 Planning、Prompt、Task、Code 节点的上游输出。

## 子任务

- [x] `[modify]` 新增 `project_scan` 节点类型
  - 修改 `shared/types.ts`、`backend/app/schemas.py` 和节点类型列表。
  - 验收：画布右键 Add Node 和 NodeInspector 类型选择中可见 `project_scan`。

- [x] `[new]` 实现后端 ProjectScanner
  - 新增 `backend/app/services/project_scanner.py`。
  - 只读扫描 `projectDir`，忽略 `.git`、`node_modules`、`dist`、`build`、`.venv`、`target` 等目录。
  - 识别常见技术栈、关键配置文件、入口文件、测试/构建命令。
  - 验收：对当前仓库扫描时能识别 React/TypeScript/FastAPI/Tauri/Python。

- [x] `[modify]` 新增 `/project/scan` API
  - 在 `backend/app/schemas.py` 增加 `ProjectScanRequest`。
  - 在 `backend/app/main.py` 暴露接口。
  - 验收：传入合法 `projectDir` 返回结构化 scan result；非法目录返回明确错误。

- [x] `[modify]` 前端接入 Project Scan 运行路径
  - 在 `frontend/src/api/backend.ts` 增加 `scanProject()`。
  - 在 `frontend/src/hooks/useRunNode.ts` 中让 `project_scan` 调用 scan API。
  - 验收：运行 Project Scan 后 `node.output` 写入项目摘要，BottomMonitor 有 START/DONE/ERROR 日志。

- [x] `[modify]` 调整 Project Scan UI
  - NodeInspector 显示 `Scan Project` 按钮。
  - Canvas 右键菜单显示 `Scan Project`。
  - 未选择 `projectDir` 时禁用运行并提示先选择工程目录。
  - 验收：Project Scan 不显示 `Generate Code`，普通节点按钮行为不变。

- [x] `[modify]` Planning 展开时自动生成 Project Scan
  - 更新 `EXPAND_SYSTEM`，让已有项目改造目标优先生成 `project_scan`。
  - 保证后续实现节点依赖 Project Scan。
  - 验收：规划文本包含“当前项目/已有代码/修复/重构/接入”时，Generate Nodes 结果包含 Project Scan；全新产品构思不生成。

- [x] `[modify]` 输出与 FileScope 建议
  - Scan result 包含 `summary`、`detectedStack`、`files`、`commands`、`suggestedFileScope`、`warnings`。
  - 将 `suggestedFileScope` 存入 `node.data.suggestedFileScope`，暂不自动覆盖节点 FileScope。
  - 验收：用户可以在输出中看到建议改动范围，但需要手动应用。

## 测试要求

- 后端：为扫描路径校验、忽略目录、技术栈识别、截断行为补单元测试。
- 前端：至少手测 Project Scan 成功、未选择工程目录、Planning 自动生成 Project Scan、普通节点运行不回归。
- 构建：前端改动后运行 `npm.cmd run build`；后端改动后运行 `uv run pytest`。

## 非目标

- 不读取和嵌入大量源码全文。
- 不做向量索引。
- 不自动修改工程文件。
- 不把 FileScope 作为强制沙箱。
- 不让 Code 节点隐式创建 Project Scan 节点。
