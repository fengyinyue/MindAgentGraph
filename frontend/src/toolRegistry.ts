// 执行器(code 节点)可调用的原生 tool 注册表 —— 声明式雏形。
//
// 这是"无限技能"飞轮里"不断扩展 tool"的注册中心起点：每加一个 tool，
// 在这里登记一项即可。每项声明它的名字、是否写文件、参数键，以及
// 输入/输出端口 —— 端口用于在 code 节点内部用连线做"数据绑定"
// (上游 output 端口 → 下游 input 端口)。tool 节点的端口由此派生，
// 不写死在节点 data 里(单一来源)。
//
// 必须与后端 NATIVE_TOOLS / _execute_native_tool 保持一致
// (backend/app/services/code_runner.py)。
//
// 约定：
//   - 输入端口 id == 工具参数键(args 的 key)，绑定时把上游值灌进该参数。
//   - 输出端口 id == 工具返回结果 dict 的字段名(顶层)，绑定时按此取值。

import type { DataPort } from "@shared/types";

export type ToolName =
  | "list_files"
  | "read_file"
  | "grep"
  | "apply_patch"
  | "write_file"
  | "delete_file"
  | "move_file"
  | "mkdir"
  | "run_command"
  | "inspect_project"
  | "get_diff"
  | "finish"
  | "value";

export interface ToolSpec {
  /** 工具名，对应后端 _execute_native_tool 的分发 key */
  name: ToolName;
  /** 是否会改动文件系统（重放时需提示/谨慎） */
  writes: boolean;
  /** 该工具接受的参数键，用于编辑器提示与默认 toolInput */
  argKeys: string[];
  /** 输入端口（id == 参数键）—— 连线进来即数据绑定 */
  inputs: DataPort[];
  /** 输出端口（id == 结果字段名）—— 连线出去供下游绑定 */
  outputs: DataPort[];
  /** 给人看的简短说明 */
  description: string;
}

const U = "unknown" as const;
const p = (id: string, name: string): DataPort => ({ id, name, type: U });

export const TOOL_REGISTRY: Record<ToolName, ToolSpec> = {
  list_files: {
    name: "list_files",
    writes: false,
    argKeys: ["path", "pattern", "limit"],
    inputs: [p("path", "path"), p("pattern", "pattern"), p("limit", "limit")],
    outputs: [p("files", "files")],
    description: "列出项目文件",
  },
  read_file: {
    name: "read_file",
    writes: false,
    argKeys: ["path"],
    inputs: [p("path", "path")],
    outputs: [p("content", "content"), p("path", "path")],
    description: "读取文本文件",
  },
  grep: {
    name: "grep",
    writes: false,
    argKeys: ["pattern", "path", "regex", "limit"],
    inputs: [p("pattern", "pattern"), p("path", "path"), p("regex", "regex"), p("limit", "limit")],
    outputs: [p("matches", "matches")],
    description: "搜索文本内容",
  },
  apply_patch: {
    name: "apply_patch",
    writes: true,
    argKeys: ["path", "oldText", "newText"],
    inputs: [p("path", "path"), p("oldText", "oldText"), p("newText", "newText")],
    outputs: [p("affectedFiles", "affectedFiles"), p("path", "path")],
    description: "替换文件中的一段文本（写文件）",
  },
  write_file: {
    name: "write_file",
    writes: true,
    argKeys: ["path", "content", "overwrite", "createDirs"],
    inputs: [p("path", "path"), p("content", "content"), p("overwrite", "overwrite"), p("createDirs", "createDirs")],
    outputs: [p("affectedFiles", "affectedFiles"), p("path", "path"), p("created", "created"), p("overwritten", "overwritten")],
    description: "新建或覆盖文本文件",
  },
  delete_file: {
    name: "delete_file",
    writes: true,
    argKeys: ["path", "confirm"],
    inputs: [p("path", "path"), p("confirm", "confirm")],
    outputs: [p("affectedFiles", "affectedFiles"), p("path", "path"), p("deleted", "deleted")],
    description: "删除文件（需要 confirm=true）",
  },
  move_file: {
    name: "move_file",
    writes: true,
    argKeys: ["sourcePath", "targetPath", "overwrite", "createDirs"],
    inputs: [p("sourcePath", "sourcePath"), p("targetPath", "targetPath"), p("overwrite", "overwrite"), p("createDirs", "createDirs")],
    outputs: [p("affectedFiles", "affectedFiles"), p("sourcePath", "sourcePath"), p("targetPath", "targetPath")],
    description: "移动或重命名文件",
  },
  mkdir: {
    name: "mkdir",
    writes: true,
    argKeys: ["path"],
    inputs: [p("path", "path")],
    outputs: [p("path", "path"), p("created", "created")],
    description: "创建目录",
  },
  run_command: {
    name: "run_command",
    writes: false,
    argKeys: ["command", "timeoutSeconds"],
    inputs: [p("command", "command"), p("timeoutSeconds", "timeoutSeconds")],
    outputs: [p("exitCode", "exitCode"), p("stdout", "stdout"), p("stderr", "stderr"), p("timedOut", "timedOut")],
    description: "运行白名单验证命令",
  },
  inspect_project: {
    name: "inspect_project",
    writes: false,
    argKeys: [],
    inputs: [],
    outputs: [p("languages", "languages"), p("packageManager", "packageManager"), p("scripts", "scripts"), p("suggestedCommands", "suggestedCommands")],
    description: "识别项目类型和可用验证命令",
  },
  get_diff: {
    name: "get_diff",
    writes: false,
    argKeys: [],
    inputs: [],
    outputs: [p("changedFiles", "changedFiles"), p("diff", "diff")],
    description: "查看本次改动的 diff",
  },
  finish: {
    name: "finish",
    writes: false,
    argKeys: ["summary"],
    inputs: [p("summary", "summary")],
    outputs: [],
    description: "结束并给出总结",
  },
  value: {
    name: "value",
    writes: false,
    argKeys: ["value"],
    inputs: [],
    outputs: [p("value", "value")],
    description: "常量/参数值（把字面值接到下游端口）",
  },
};

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && value in TOOL_REGISTRY;
}

export function toolSpec(name: string): ToolSpec | undefined {
  return isToolName(name) ? TOOL_REGISTRY[name] : undefined;
}

/** 该工具是否会写文件（未知工具按写处理，偏保守） */
export function toolWrites(name: string): boolean {
  const spec = toolSpec(name);
  return spec ? spec.writes : true;
}

/** tool 节点的端口（由注册表派生）。未知工具回退到单 in/out。 */
export function toolPorts(name: string): { inputs: DataPort[]; outputs: DataPort[] } {
  const spec = toolSpec(name);
  if (!spec) return { inputs: [p("in", "In")], outputs: [p("out", "Out")] };
  return { inputs: spec.inputs, outputs: spec.outputs };
}
