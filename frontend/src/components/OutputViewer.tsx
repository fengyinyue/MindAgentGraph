import { type ReactNode, useMemo, useState } from "react";
import { useGraphStore } from "@/store/graphStore";
import { useOutputPanelStore } from "@/store/outputPanelStore";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function inlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) nodes.push(value.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.9em] text-zinc-100">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold text-zinc-50">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key} className="text-zinc-100">{token.slice(1, -1)}</em>);
    } else {
      const label = token.match(/^\[([^\]]+)\]/)?.[1] ?? token;
      nodes.push(<span key={key} className="text-accent">{label}</span>);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) nodes.push(value.slice(lastIndex));
  return nodes;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function MarkdownPreview({ value, compact = false }: { value: string; compact?: boolean }) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += i < lines.length ? 1 : 0;
      blocks.push(
        <div key={`code-${i}`} className="overflow-hidden rounded border border-zinc-800 bg-zinc-950">
          {language ? (
            <div className="border-b border-zinc-800 px-3 py-1 text-[11px] uppercase text-zinc-500">{language}</div>
          ) : null}
          <pre className="overflow-auto p-3 text-[13px] leading-6 text-zinc-200">
            <code>{code.join("\n")}</code>
          </pre>
        </div>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = inlineMarkdown(heading[2]);
      const className = compact
        ? level === 1
          ? "mt-1 border-b border-zinc-800 pb-1 text-sm font-semibold text-zinc-50"
          : level === 2
            ? "mt-3 border-b border-zinc-800 pb-1 text-sm font-semibold text-zinc-50"
            : "mt-2 text-xs font-semibold text-zinc-100"
        : level === 1
          ? "mt-1 border-b border-zinc-800 pb-2 text-2xl font-semibold text-zinc-50"
          : level === 2
            ? "mt-7 border-b border-zinc-800 pb-1 text-xl font-semibold text-zinc-50"
            : level === 3
              ? "mt-6 text-lg font-semibold text-zinc-100"
              : "mt-4 text-base font-semibold text-zinc-100";
      const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(<HeadingTag key={`heading-${i}`} className={className}>{content}</HeadingTag>);
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="border-zinc-800" />);
      i += 1;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={`table-${i}`} className="overflow-auto rounded border border-zinc-800">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-zinc-900 text-zinc-100">
              <tr>
                {headers.map((cell, index) => (
                  <th key={index} className="border-b border-zinc-800 px-3 py-2 font-semibold">
                    {inlineMarkdown(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-zinc-800/70">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top text-zinc-300">
                      {inlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))) {
        items.push(lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, ""));
        i += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={`list-${i}`} className={ordered ? "list-decimal space-y-1 pl-6 text-zinc-300" : "list-disc space-y-1 pl-6 text-zinc-300"}>
          {items.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}
        </ListTag>,
      );
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote key={`quote-${i}`} className="border-l-4 border-zinc-700 pl-4 text-zinc-400">
          {quote.map((item, index) => <p key={index}>{inlineMarkdown(item)}</p>)}
        </blockquote>,
      );
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith("```") &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith(">") &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={`paragraph-${i}`} className="text-zinc-300">
        {inlineMarkdown(paragraph.join(" "))}
      </p>,
    );
  }

  return (
    <div className={compact ? "space-y-2 text-xs leading-5" : "mx-auto max-w-4xl space-y-4 text-[15px] leading-7"}>
      {blocks}
    </div>
  );
}

export default function OutputViewer() {
  const nodeId = useOutputPanelStore((s) => s.nodeId);
  const mode = useOutputPanelStore((s) => s.mode);
  const close = useOutputPanelStore((s) => s.close);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId));
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const output = useMemo(() => {
    if (!node) return "";
    if (mode === "code") return text(node.data?.codeOutput) || text(node.output);
    return text(node.output) || text(node.data?.output);
  }, [mode, node]);

  if (!nodeId) return null;

  const title = node
    ? `${node.title} / ${mode === "code" ? "Execution Output" : "Explain Output"}`
    : "Output";

  const onCopy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/50" onClick={close}>
      <section
        className="absolute inset-x-6 top-8 bottom-8 mx-auto max-w-5xl overflow-hidden rounded border border-zinc-700 bg-panel shadow-2xl"
        role="dialog"
        aria-label="Node output"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex h-11 items-center gap-2 border-b border-zinc-800 px-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-zinc-100">{title}</div>
            {node ? <div className="text-[11px] text-zinc-500">{node.id}</div> : null}
          </div>
          <button
            className={
              previewMode
                ? "rounded border border-accent bg-accent/10 px-2.5 py-1 text-xs text-accent"
                : "rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-accent hover:text-accent"
            }
            onClick={() => setPreviewMode((value) => !value)}
            aria-pressed={previewMode}
          >
            Preview
          </button>
          <button
            className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-accent hover:text-accent disabled:opacity-40"
            onClick={onCopy}
            disabled={!output}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            className="rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:border-accent hover:text-accent"
            onClick={close}
          >
            Close
          </button>
        </header>

        <div className="h-[calc(100%-44px)] overflow-auto bg-canvas p-5">
          {output && previewMode ? (
            <MarkdownPreview value={output} />
          ) : output ? (
            <pre
              className={
                mode === "code"
                  ? "whitespace-pre-wrap break-words font-mono text-sm leading-6 text-zinc-200"
                  : "whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200"
              }
            >
{output}
            </pre>
          ) : (
            <div className="text-sm text-zinc-500">No output yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
