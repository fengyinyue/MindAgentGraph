import { useMemo, useState } from "react";
import { useGraphStore } from "@/store/graphStore";
import { useOutputPanelStore } from "@/store/outputPanelStore";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default function OutputViewer() {
  const nodeId = useOutputPanelStore((s) => s.nodeId);
  const mode = useOutputPanelStore((s) => s.mode);
  const close = useOutputPanelStore((s) => s.close);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId));
  const [copied, setCopied] = useState(false);

  const output = useMemo(() => {
    if (!node) return "";
    if (mode === "code") return text(node.data?.codeOutput) || text(node.output);
    return text(node.output) || text(node.data?.output);
  }, [mode, node]);

  if (!nodeId) return null;

  const title = node
    ? `${node.title} / ${mode === "code" ? "Code Output" : "Explain Output"}`
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
          {output ? (
            <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-200">
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
