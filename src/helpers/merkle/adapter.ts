import { MerkleMsg, MerkleRootMsg, GetNodeMsg, NodeResponseMsg, Node } from './types';
import * as dagStore from './dagStore';
import { cidFor, verifyCid } from './cid';

export interface MerkleAdapterConfig {
  sendToPeer: (peerId: string, msg: any) => void;
  broadcastToPeers: (msg: any) => void;
}

export function createMerleAdapter(config: MerkleAdapterConfig) {
  const { sendToPeer, broadcastToPeers } = config;

  let onNodeReceived: (node: Node, from?: string) => void = () => {};
  let onRootAnnounced: (cid: string, from?: string) => void = () => {};
  const seenCids: Set<string> = new Set();
  const pendingRequests: Map<string, (node: Node | null) => void> = new Map();
  const heads: Set<string> = new Set();

  function updateHeads(cid: string, node: Node) {
    try {
      for (const l of node.links || []) {
        if (heads.has(l)) heads.delete(l)
      }
      heads.add(cid)
    } catch (e) {
    }
  }

  function createNodeFromOps(ops: Node['payload'], author?: string): Node {
    const node: Node = {
      links: Array.from(heads),
      payload: ops || [],
      meta: { author: author || 'local', ts: Date.now() }
    }
    return node
  }

  async function createAndBroadcast(boardId: string | undefined, ops: Node['payload'], author?: string) {
    const node = createNodeFromOps(ops, author)
    return await broadcastRoot(boardId, node)
  }

  async function broadcastRoot(boardId: string | undefined, node?: Node) {
    if (!node) throw new Error('node required for broadcastRoot in payload-in-broadcast mode');
    try {
      const currentHeads = Array.from(heads)
      const merged = Array.from(new Set([...(node.links || []), ...currentHeads]))
      node.links = merged
    } catch (e) {
    }
    const cid = await cidFor(node);
    await dagStore.Put(node);
    try { updateHeads(cid, node) } catch (e) { }
    try { onNodeReceived(node, undefined) } catch (e) { }
    seenCids.add(cid);
    const msg: MerkleRootMsg = {
      type: 'MERKLE_ROOT',
      boardId,
      cid,
      ts: Date.now(),
      payload: node,
    };
    broadcastToPeers(msg);
    return cid;
  }

  async function sendRootToPeer(peerId: string, boardId: string | undefined, node: Node) {
    if (!peerId) throw new Error('peerId required')
    try {
      const currentHeads = Array.from(heads)
      const merged = Array.from(new Set([...(node.links || []), ...currentHeads]))
      node.links = merged
    } catch (e) {
    }
    const cid = await cidFor(node);
    await dagStore.Put(node);
    seenCids.add(cid);
    const msg: MerkleRootMsg = {
      type: 'MERKLE_ROOT',
      boardId,
      cid,
      ts: Date.now(),
      payload: node,
    };
    try { sendToPeer(peerId, msg) } catch (e) { }
    return cid;
  }

  async function onIncomingMessage(msg: MerkleMsg, from?: string) {
    if (!msg || !msg.type) return;
    if (msg.type === 'MERKLE_ROOT') {
      const m = msg as MerkleRootMsg;
      onRootAnnounced(m.cid, from);
      if (seenCids.has(m.cid)) return
      if (m.payload) {
        try {
          const ok = await verifyCid(m.payload, m.cid);
          if (ok) {
            await dagStore.Put(m.payload);
            try { updateHeads(m.cid, m.payload) } catch (e) { }
            seenCids.add(m.cid);
            onNodeReceived(m.payload, from);
            try { broadcastToPeers(m) } catch (e) { }
          } else {
            const reqId = `req-${Date.now()}`;
            const getMsg: GetNodeMsg = { type: 'GET_NODE', boardId: m.boardId, cid: m.cid, requestId: reqId, from };
            broadcastToPeers(getMsg);
          }
        } catch (e) {
        }
      } else {
        try {
          const node = await requestNode(m.cid, from);
          if (node) {
            await dagStore.Put(node);
            try { updateHeads(m.cid, node) } catch (e) { }
            seenCids.add(m.cid);
            onNodeReceived(node, from);
            try { broadcastToPeers(m) } catch (e) { }
          } else {
          }
        } catch (e) {
        }
      }
    } else if (msg.type === 'GET_NODE') {
      const m = msg as GetNodeMsg;
      const node = await dagStore.Get(m.cid);
      if (node) {
        const resp: NodeResponseMsg = { type: 'NODE_RESPONSE', boardId: m.boardId, cid: m.cid, node, requestId: m.requestId, from: undefined };
        if (from) sendToPeer(from, resp);
        else broadcastToPeers(resp);
      }
    } else if (msg.type === 'NODE_RESPONSE') {
      const m = msg as NodeResponseMsg;
      try {
        const ok = await verifyCid(m.node, m.cid);
        if (ok) {
          await dagStore.Put(m.node);
          try { updateHeads(m.cid, m.node) } catch (e) { }
          if (!seenCids.has(m.cid)) {
            seenCids.add(m.cid);
            onNodeReceived(m.node, from);
            try { broadcastToPeers({ type: 'MERKLE_ROOT', boardId: m.boardId, cid: m.cid, ts: Date.now(), payload: m.node }) } catch (e) { }
          }
          const resolver = pendingRequests.get(m.cid);
          if (resolver) {
            resolver(m.node);
            pendingRequests.delete(m.cid);
          }
        }
      } catch (e) {
      }
    }
  }

  async function requestNode(cid: string, fromPeer?: string, timeout = 5000): Promise<Node | null> {
    const local = await dagStore.Get(cid);
    if (local) return local;
    return await new Promise<Node | null>((resolve) => {
      pendingRequests.set(cid, resolve);
      const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const getMsg: GetNodeMsg = { type: 'GET_NODE', boardId: undefined, cid, requestId: reqId, from: undefined };
      if (fromPeer) sendToPeer(fromPeer, getMsg);
      else broadcastToPeers(getMsg);
      setTimeout(() => {
        const resolver = pendingRequests.get(cid);
        if (resolver) {
          resolver(null);
          pendingRequests.delete(cid);
        }
      }, timeout);
    });
  }

  return {
    broadcastRoot,
    sendRootToPeer,
    requestNode,
    onIncomingMessage,
    createNodeFromOps,
    createAndBroadcast,
    updateHeads,
    getHeads: () => Array.from(heads),
    set onNodeReceived(fn: (node: Node, from?: string) => void) {
      onNodeReceived = fn;
    },
    set onRootAnnounced(fn: (cid: string, from?: string) => void) {
      onRootAnnounced = fn;
    },
    dagStore,
  };
}
