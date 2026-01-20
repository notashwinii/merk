import { Node } from './types'
import * as dagStore from './dagStore'
import { cidFor } from './cid'

export interface OpApplier {
  applyOp: (op: any) => Promise<void> | void;
}

export function createWalker(adapter: any, applier: OpApplier) {
  const seenCids: Set<string> = new Set() // Processed nodes
  const seenOps: Set<string> = new Set() // Applied operations
  const syncing: Set<string> = new Set()

  async function processNode(node: Node) {
    // When a node is received directly, store it and trigger a sync
    // which will fetch the subgraph and apply nodes in deterministic order.
    const cid = await cidFor(node)
    if (seenCids.has(cid)) return
    // persist the node locally so syncRoot can discover it from dagStore
    await dagStore.Put(node)
    // trigger a sync rooted at this cid which will apply nodes in topo order
    try {
      await syncRoot(cid)
    } catch (e) {
      // non-fatal; log and continue
      console.warn('processNode syncRoot error', e)
    }
  }

  async function fetchMissingNodes(rootCid: string, fromPeer?: string) : Promise<Map<string, Node>> {
    const missingStack: string[] = [rootCid]
    const fetched = new Map<string, Node>()
    while (missingStack.length > 0) {
      const cid = missingStack.pop() as string
      if (seenCids.has(cid) || fetched.has(cid)) continue
      const local = await dagStore.Get(cid)
      if (local) {
        fetched.set(cid, local)
        for (const l of local.links || []) {
          if (!seenCids.has(l) && !fetched.has(l)) missingStack.push(l)
        }
        continue
      }
      const node = await adapter.requestNode(cid, fromPeer, 5000)
      if (!node) throw new Error(`Failed to fetch node ${cid}`)
      fetched.set(cid, node)
      for (const l of node.links || []) {
        if (!seenCids.has(l) && !fetched.has(l)) missingStack.push(l)
      }
    }
    return fetched
  }

  function topoSortNodes(nodesMap: Map<string, Node>): string[] {
    // Deterministic Kahn topological sort using node CIDs as tie-breakers
    const indegree = new Map<string, number>()
    const adj = new Map<string, string[]>()
    nodesMap.forEach((node, cid) => {
      if (!indegree.has(cid)) indegree.set(cid, 0)
      for (const l of node.links || []) {
        if (!nodesMap.has(l)) continue
        if (!adj.has(l)) adj.set(l, [])
        adj.get(l)!.push(cid)
        indegree.set(cid, (indegree.get(cid) || 0) + 1)
      }
    })

    // Initialize queue with indegree-0 nodes (Kahn step 2)
    const q: string[] = []
    indegree.forEach((deg, cid) => {
      if (deg === 0) q.push(cid)
    })

    // Tie-breaker: lexicographic order of CID (deterministic)
    q.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    const order: string[] = []

    // Repeatedly remove, output, and relax edges(Kahn step 3)
    while (q.length > 0) {
      const n = q.shift() as string
      order.push(n)
      const outs = adj.get(n) || []
      for (const m of outs) {
        indegree.set(m, (indegree.get(m) || 0) - 1)
        if (indegree.get(m) === 0) {
          q.push(m)
          q.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        }
      }
    }
    nodesMap.forEach((_node, cid) => { if (!order.includes(cid)) order.push(cid) })
    return order
  }

  async function applyNodeDirect(node: Node, cid: string) {
    if (seenCids.has(cid)) return
    if (Array.isArray(node.payload)) {
      for (const op of node.payload) {
        if (!op || !op.opId) continue
        if (seenOps.has(op.opId)) continue
        try {
          await applier.applyOp(op)
        } catch (e) {
          console.warn('applyOp error', e)
        }
        seenOps.add(op.opId)
      }
    }
    await dagStore.Put(node)
    seenCids.add(cid)
    try {
      if (adapter && typeof adapter.updateHeads === 'function') {
        await adapter.updateHeads(cid, node)
      }
    } catch (e) {
    }
  }

  async function applyNodesInOrder(order: string[], nodesMap: Map<string, Node>) {
    for (const cid of order) {
      const node = nodesMap.get(cid)
      if (!node) continue
      await applyNodeDirect(node, cid)
    }
  }

  async function syncRoot(rootCid: string, fromPeer?: string) {
    if (seenCids.has(rootCid)) return
    if (syncing.has(rootCid)) return
    syncing.add(rootCid)
    try {
      const fetched = await fetchMissingNodes(rootCid, fromPeer)
      const order = topoSortNodes(fetched)
      await applyNodesInOrder(order, fetched)
    } finally {
      syncing.delete(rootCid)
    }
  }

  return { syncRoot, processNode, seenCids, seenOps }
}
