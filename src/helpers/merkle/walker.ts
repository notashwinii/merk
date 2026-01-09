import { Node } from './types'
import * as dagStore from './dagStore'
import { cidFor } from './cid'

export interface OpApplier {
  applyOp: (op: any) => Promise<void> | void;
}

export function createWalker(adapter: any, applier: OpApplier) {
  const seenCids: Set<string> = new Set()
  const seenOps: Set<string> = new Set()
  const syncing: Set<string> = new Set()

  async function processNode(node: Node) {
    const cid = await cidFor(node)
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
    function sortKey(cid: string) {
      const node = nodesMap.get(cid)!
      let minTs = Number.MAX_SAFE_INTEGER
      if (Array.isArray(node.payload) && node.payload.length > 0) {
        for (const op of node.payload) {
          if (op && typeof op.ts === 'number' && op.ts < minTs) minTs = op.ts
        }
      }
      if (minTs === Number.MAX_SAFE_INTEGER) {
        if (node.meta && typeof node.meta.ts === 'number') minTs = node.meta.ts
        else minTs = 0
      }
      const author = (node.meta && node.meta.author) || (Array.isArray(node.payload) && node.payload[0] && node.payload[0].actor) || ''
      return { minTs, author, cid }
    }

    const q: string[] = []
    indegree.forEach((deg, cid) => {
      if (deg === 0) q.push(cid)
    })
    q.sort((a, b) => {
      const A = sortKey(a), B = sortKey(b)
      if (A.minTs !== B.minTs) return A.minTs - B.minTs
      if (A.author !== B.author) return A.author < B.author ? -1 : 1
      return A.cid < B.cid ? -1 : 1
    })
    const order: string[] = []
    while (q.length > 0) {
      const n = q.shift() as string
      order.push(n)
      const outs = adj.get(n) || []
      for (const m of outs) {
        indegree.set(m, (indegree.get(m) || 0) - 1)
        if (indegree.get(m) === 0) {
          q.push(m)
          q.sort((a, b) => {
            const A = sortKey(a), B = sortKey(b)
            if (A.minTs !== B.minTs) return A.minTs - B.minTs
            if (A.author !== B.author) return A.author < B.author ? -1 : 1
            return A.cid < B.cid ? -1 : 1
          })
        }
      }
    }
    nodesMap.forEach((_node, cid) => { if (!order.includes(cid)) order.push(cid) })
    return order
  }

  async function applyNodesInOrder(order: string[], nodesMap: Map<string, Node>) {
    for (const cid of order) {
      const node = nodesMap.get(cid)
      if (!node) continue
      await processNode(node)
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
