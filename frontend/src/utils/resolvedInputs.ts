import type { DataPort, Edge, NodeBase } from "@shared/types";

export interface ResolvedInput {
  key: string;
  sourceNodeId: string;
  sourceTitle: string;
  targetNodeId: string;
  targetTitle: string;
  sourceHandle?: string;
  sourcePortName?: string;
  targetHandle?: string;
  targetPortName?: string;
  status: "resolved" | "empty" | "disabled";
  sourceKind: "data-field" | "code-output" | "diff" | "changed-files" | "json-field" | "markdown-section" | "output" | "purpose" | "empty" | "disabled";
  rawLength: number;
  passedLength: number;
  truncated: boolean;
  content: string;
}

export interface ResolvedOutput {
  handle: string;
  name: string;
  type: DataPort["type"];
  status: "resolved" | "empty";
  sourceKind: ResolvedInput["sourceKind"];
  rawLength: number;
  content: string;
}

export function outputText(node: NodeBase | undefined): string {
  if (!node) return "";
  const text = node.type === "code"
    ? (node.data?.codeOutput ?? node.output ?? node.data?.output)
    : (node.output ?? node.data?.output ?? node.data?.codeOutput);
  return typeof text === "string" ? text : "";
}

export function resolveOutputPort(node: NodeBase, port: DataPort): ResolvedOutput {
  const extracted = extractOutputForHandle(node, port.id);
  const content = extracted.text.trim();
  return {
    handle: port.id,
    name: port.name,
    type: port.type,
    status: content ? "resolved" : "empty",
    sourceKind: content ? extracted.kind : "empty",
    rawLength: extracted.text.length,
    content,
  };
}

export function listMarkdownSections(text: string): string[] {
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const title = match[2].trim();
    const key = normalizeBindingName(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sections.push(title);
  }
  return sections;
}

export function listJsonOutputFields(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const record = parsed as Record<string, unknown>;
    const fields = Object.keys(record);
    const outputs = record.outputs;
    if (outputs && typeof outputs === "object" && !Array.isArray(outputs)) {
      for (const key of Object.keys(outputs as Record<string, unknown>)) {
        fields.push(`outputs.${key}`);
      }
    }
    return Array.from(new Set(fields));
  } catch {
    return [];
  }
}

export function nodePurposeText(node: NodeBase): string {
  const text = node.purpose ?? (node.data?.purpose as string | undefined) ?? "";
  return typeof text === "string" ? text : "";
}

export function portName(node: NodeBase, direction: "inputs" | "outputs", handle?: string | null): string | undefined {
  if (!handle) return undefined;
  const ports = node.data?.[direction];
  if (!Array.isArray(ports)) return undefined;
  for (const raw of ports) {
    if (!raw || typeof raw !== "object") continue;
    const port = raw as { id?: unknown; name?: unknown };
    if (port.id === handle && typeof port.name === "string") return port.name;
  }
  return undefined;
}

export function resolvedInputsToParentOutputs(items: ResolvedInput[]): Record<string, string> | undefined {
  const outputs: Record<string, string> = {};
  for (const item of items) {
    if (item.status !== "resolved" || !item.content.trim()) continue;
    putUnique(outputs, item.key, item.content);
  }
  return Object.keys(outputs).length ? outputs : undefined;
}

export function collectResolvedInputs(
  nodes: NodeBase[],
  links: Edge[],
  nodeId: string,
  opts: { includeTransitive?: boolean; maxChars?: number } = {},
): ResolvedInput[] {
  const includeTransitive = opts.includeTransitive ?? false;
  const maxChars = opts.maxChars ?? 1200;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const targetNode = byId.get(nodeId);
  if (!targetNode) return [];

  if (targetNode.contextMode !== "inherit") {
    return links
      .filter((link) => link.target === nodeId)
      .flatMap((link) => {
        const source = byId.get(link.source);
        if (!source) return [];
        return [{
          key: bindingKey(source, targetNode, link),
          sourceNodeId: source.id,
          sourceTitle: source.title,
          targetNodeId: targetNode.id,
          targetTitle: targetNode.title,
          sourceHandle: link.sourceHandle,
          sourcePortName: portName(source, "outputs", link.sourceHandle),
          targetHandle: link.targetHandle,
          targetPortName: portName(targetNode, "inputs", link.targetHandle),
          status: "disabled",
          sourceKind: "disabled",
          rawLength: 0,
          passedLength: 0,
          truncated: false,
          content: "",
        } satisfies ResolvedInput];
      });
  }

  const visiting = new Set<string>();
  const visitedEdges = new Set<string>();
  const ordered: Edge[] = [];

  const visitParents = (id: string) => {
    if (visiting.has(id)) return;
    visiting.add(id);
    for (const link of links.filter((l) => l.target === id)) {
      if (includeTransitive) visitParents(link.source);
      if (!visitedEdges.has(link.id)) {
        visitedEdges.add(link.id);
        ordered.push(link);
      }
    }
    visiting.delete(id);
  };

  visitParents(nodeId);

  return ordered.flatMap((link) => {
    const source = byId.get(link.source);
    const target = byId.get(link.target) ?? targetNode;
    if (!source || !target) return [];
    const extracted = extractOutputForHandle(source, link.sourceHandle);
    const content = truncateForContext(extracted.text, maxChars);
    return [{
      key: bindingKey(source, target, link),
      sourceNodeId: source.id,
      sourceTitle: source.title,
      targetNodeId: target.id,
      targetTitle: target.title,
      sourceHandle: link.sourceHandle,
      sourcePortName: portName(source, "outputs", link.sourceHandle),
      targetHandle: link.targetHandle,
      targetPortName: portName(target, "inputs", link.targetHandle),
      status: content.trim() ? "resolved" : "empty",
      sourceKind: content.trim() ? extracted.kind : "empty",
      rawLength: extracted.text.length,
      passedLength: content.length,
      truncated: content.length < extracted.text.length,
      content,
    } satisfies ResolvedInput];
  });
}

function truncateForContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

function stringifyBindingValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function tryJsonField(text: string, handle: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const record = parsed as Record<string, unknown>;
    const direct = record[handle];
    if (direct !== undefined) return stringifyBindingValue(direct);
    const outputs = record.outputs;
    if (outputs && typeof outputs === "object" && !Array.isArray(outputs)) {
      const nested = (outputs as Record<string, unknown>)[handle];
      if (nested !== undefined) return stringifyBindingValue(nested);
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeBindingName(value: string): string {
  return value.replace(/`/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function markdownSection(text: string, names: string[]): string {
  const lines = text.split(/\r?\n/);
  const normalized = new Set(names.map(normalizeBindingName).filter(Boolean));
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (!match) continue;
    const level = match[1].length;
    const heading = normalizeBindingName(match[2]);
    if (!normalized.has(heading)) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = /^(#{1,6})\s+/.exec(lines[j]);
      if (next && next[1].length <= level) break;
      body.push(lines[j]);
    }
    return body.join("\n").trim();
  }
  return "";
}

function extractOutputForHandle(node: NodeBase, sourceHandle?: string | null): { text: string; kind: ResolvedInput["sourceKind"] } {
  const fullText = outputText(node).trim();
  const purpose = nodePurposeText(node).trim();
  const fallbackText = fullText || purpose;
  if (!sourceHandle) {
    return { text: fallbackText, kind: fullText ? "output" : purpose ? "purpose" : "empty" };
  }

  const dataValue = node.data?.[sourceHandle];
  const direct = stringifyBindingValue(dataValue).trim();
  if (direct) return { text: direct, kind: "data-field" };

  if (node.type === "code") {
    if (sourceHandle === "result" || sourceHandle === "codeOutput") {
      const codeOutput = stringifyBindingValue(node.data?.codeOutput).trim();
      if (codeOutput) return { text: codeOutput, kind: "code-output" };
    }
    if (sourceHandle === "diff") {
      const diff = node.data?.codeDiff as { diff?: unknown } | undefined;
      const diffText = stringifyBindingValue(diff?.diff).trim();
      if (diffText) return { text: diffText, kind: "diff" };
    }
    if (sourceHandle === "changedFiles" || sourceHandle === "files") {
      const files = stringifyBindingValue(node.data?.generatedFiles).trim();
      if (files) return { text: files, kind: "changed-files" };
    }
  }

  if (fullText) {
    const jsonField = tryJsonField(fullText, sourceHandle).trim();
    if (jsonField) return { text: jsonField, kind: "json-field" };
    const section = markdownSection(fullText, [
      sourceHandle,
      portName(node, "outputs", sourceHandle) ?? "",
    ]).trim();
    if (section) return { text: section, kind: "markdown-section" };
  }
  return { text: fallbackText, kind: fullText ? "output" : purpose ? "purpose" : "empty" };
}

function bindingKey(source: NodeBase, target: NodeBase, link: Edge): string {
  if (link.sourceHandle || link.targetHandle) {
    const sourcePort = portName(source, "outputs", link.sourceHandle) ?? link.sourceHandle ?? "output";
    const targetPort = portName(target, "inputs", link.targetHandle) ?? link.targetHandle ?? "input";
    return `${target.title}.${targetPort} <= ${source.title}.${sourcePort} (${source.id})`;
  }
  return `${source.title} (${source.id})`;
}

function putUnique(outputs: Record<string, string>, key: string, value: string): void {
  const text = value.trim();
  if (!text) return;
  if (!outputs[key]) {
    outputs[key] = text;
    return;
  }
  let i = 2;
  while (outputs[`${key} #${i}`]) i += 1;
  outputs[`${key} #${i}`] = text;
}
