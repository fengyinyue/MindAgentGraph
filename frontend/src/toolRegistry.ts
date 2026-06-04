// 执行器(code 节点)可调用的原生 tool 注册表 —— 声明式雏形。
//
// 这是"无限技能"飞轮里"不断扩展 tool"的注册中心起点：每加一个 tool，
// 在这里登记一项即可。当前只描述每个 tool 的名字、是否写文件、参数键，
// 不含数据流端口（执行层重放靠自包含 args，不需要端口连线）。
//
// 必须与后端 NATIVE_TOOLS / _execute_native_tool 保持一致
// (backend/app/services/code_runner.py)。

export type ToolName =
  | "list_files"
  | "read_file"
  | "grep"
  | "apply_patch"
  | "get_diff"
  | "finish";

export interface ToolSpec {
  /** 工具名，对应后端 _execute_native_tool 的分发 key */
  name: ToolName;
  /** 是否会改动文件系统（重放时需提示/谨慎） */
  writes: boolean;
  /** 该工具接受的参数键，用于编辑器提示与默认 toolInput */
  argKeys: string[];
  /** 给人看的简短说明 */
  description: string;
}

export const TOOL_REGISTRY: Record<ToolName, ToolSpec> = {
  list_files: {
    name: "list_files",
    writes: false,
    argKeys: ["path", "pattern", "limit"],
    description: "列出项目文件",
  },
  read_file: {
    name: "read_file",
    writes: false,
    argKeys: ["path"],
    description: "读取文本文件",
  },
  grep: {
    name: "grep",
    writes: false,
    argKeys: ["pattern", "path", "regex", "limit"],
    description: "搜索文本内容",
  },
  apply_patch: {
    name: "apply_patch",
    writes: true,
    argKeys: ["path", "oldText", "newText"],
    description: "替换文件中的一段文本（写文件）",
  },
  get_diff: {
    name: "get_diff",
    writes: false,
    argKeys: [],
    description: "查看本次改动的 diff",
  },
  finish: {
    name: "finish",
    writes: false,
    argKeys: ["summary"],
    description: "结束并给出总结",
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
