import type { Edge, NodeBase } from "@shared/types";

const RANK_GAP = 340;
const ROW_GAP = 170;

/**
 * Topological-rank auto-layout for the whole graph.
 *
 * Frames (= groups of nodes sharing the same parentId) are laid out
 * independently; each frame becomes a left-to-right DAG with siblings
 * stacked vertically inside their rank. Top-level frame keeps its current
 * top-left anchor so the layout doesn't teleport the user; subgraph child
 * frames anchor at (0,0) since they're rendered in isolation when entered.
 *
 * Returns a map of {nodeId -> new position}. Only nodes that move are
 * included; cycles fall back to rank 0 for nodes never reached.
 */
export function autoLayoutGraph(
  nodes: NodeBase[],
  links: Edge[],
): Map<string, { x: number; y: number }> {
  const byFrame = new Map<string | undefined, NodeBase[]>();
  for (const node of nodes) {
    const key = node.parentId;
    const list = byFrame.get(key);
    if (list) list.push(node);
    else byFrame.set(key, [node]);
  }

  const positions = new Map<string, { x: number; y: number }>();

  for (const [frameKey, frameNodes] of byFrame) {
    if (frameNodes.length === 0) continue;
    const frameIds = new Set(frameNodes.map((n) => n.id));
    const frameLinks = links.filter(
      (l) => frameIds.has(l.source) && frameIds.has(l.target),
    );

    const incoming = new Map<string, number>(frameNodes.map((n) => [n.id, 0]));
    const outgoing = new Map<string, string[]>(
      frameNodes.map((n) => [n.id, []]),
    );
    for (const link of frameLinks) {
      outgoing.get(link.source)!.push(link.target);
      incoming.set(link.target, (incoming.get(link.target) ?? 0) + 1);
    }

    const queue = frameNodes
      .filter((n) => (incoming.get(n.id) ?? 0) === 0)
      .sort(
        (a, b) =>
          a.position.y - b.position.y || a.position.x - b.position.x,
      )
      .map((n) => n.id);
    const rank = new Map<string, number>(frameNodes.map((n) => [n.id, 0]));
    const remaining = new Map(incoming);
    while (queue.length) {
      const id = queue.shift()!;
      for (const target of outgoing.get(id) ?? []) {
        rank.set(
          target,
          Math.max(rank.get(target) ?? 0, (rank.get(id) ?? 0) + 1),
        );
        remaining.set(target, (remaining.get(target) ?? 0) - 1);
        if ((remaining.get(target) ?? 0) === 0) queue.push(target);
      }
    }

    let originX = 0;
    let originY = 0;
    if (frameKey === undefined) {
      const minX = Math.min(...frameNodes.map((n) => n.position.x));
      const minY = Math.min(...frameNodes.map((n) => n.position.y));
      originX = Math.round(minX / 10) * 10;
      originY = Math.round(minY / 10) * 10;
    }

    const byRank = new Map<number, NodeBase[]>();
    for (const node of frameNodes) {
      const r = rank.get(node.id) ?? 0;
      const bucket = byRank.get(r);
      if (bucket) bucket.push(node);
      else byRank.set(r, [node]);
    }

    for (const [r, rankNodes] of byRank) {
      const ordered = [...rankNodes].sort(
        (a, b) =>
          a.position.y - b.position.y ||
          a.position.x - b.position.x ||
          a.title.localeCompare(b.title),
      );
      const centerOffset = ((ordered.length - 1) * ROW_GAP) / 2;
      ordered.forEach((node, idx) => {
        positions.set(node.id, {
          x: originX + r * RANK_GAP,
          y: originY + idx * ROW_GAP - centerOffset,
        });
      });
    }
  }

  return positions;
}
