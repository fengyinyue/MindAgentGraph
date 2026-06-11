import type { NodeBase, Edge } from "@shared/types";
import type { ToolStep } from "@/api/backend";

/**
 * 从某个 code 节点的内部 tool 子图收集可重放的步骤序列。
 *
 * - 取该 code 节点的 tool 子节点（parentId === codeNodeId 且 data.tool 为字符串）；
 * - 按 data.order 排序；
 * - 把子图内部"带端口的连线"转成数据绑定（sourceHandle/targetHandle）。
 *
 * 被 replayTools（重放）和 skill 捕获（存技能）共用。
 * onlyIds 用于单步重放，仅保留指定节点。
 */
export function collectToolSteps(
  nodes: NodeBase[],
  links: Edge[],
  codeNodeId: string,
  onlyIds?: Set<string>,
): ToolStep[] {
  const toolNodes = nodes
    .filter((n) => n.parentId === codeNodeId && typeof n.data?.tool === "string")
    .filter((n) => !onlyIds || onlyIds.has(n.id))
    .sort((a, b) => Number(a.data?.order ?? 0) - Number(b.data?.order ?? 0));
  const ids = new Set(toolNodes.map((n) => n.id));
  return toolNodes.map((n) => ({
    id: n.id,
    tool: n.data?.tool as string,
    input: (n.data?.toolInput as Record<string, unknown>) ?? {},
    bindings: links
      .filter(
        (l) =>
          l.target === n.id &&
          ids.has(l.source) &&
          l.sourceHandle &&
          l.targetHandle,
      )
      .map((l) => ({
        targetArg: l.targetHandle as string,
        sourceStepId: l.source,
        sourceField: l.sourceHandle as string,
      })),
  }));
}
