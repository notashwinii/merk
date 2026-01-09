import { MerkleMsg, MerkleRootMsg, GetNodeMsg, NodeResponseMsg, Node } from './types';
import * as dagStore from './dagStore';
import { cidFor, verifyCid } from './cid';

export interface MerkleAdapterConfig {
  sendToPeer: (peerId: string, msg: any) => void;
  broadcastToPeers: (msg: any) => void;
}

export function createMerleAdapter(config: MerkleAdapterConfig) {
  const { sendToPeer, broadcastToPeers } = config;

  // callback hooks to be set by consumer
  let onNodeReceived: (node: Node, from?: string) => void = () => {};
  let onRootAnnounced: (cid: string, from?: string) => void = () => {};
  const seenCids: Set<string> = new Set();
  const pendingRequests: Map<string, (node: Node | null) => void> = new Map();
  // heads tracking for Implementation Rule (IR)
  const heads: Set<string> = new Set();

  function updateHeads(cid: string, node: Node) {
    try {
      // remove referenced links from heads (they are no longer heads)
      for (const l of node.links || []) {
        if (heads.has(l)) heads.delete(l)
      }
      // add this cid as a new head
      heads.add(cid)
    } catch (e) {
      // ignore errors
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
    const cid = await cidFor(node);
    // store locally
  await dagStore.Put(node);
  // update heads per IR
  try { updateHeads(cid, node) } catch (e) { /* ignore */ }
  // notify local consumer immediately so creator also applies its own node
  try { onNodeReceived(node, undefined) } catch (e) { /* ignore */ }
  // mark seen
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

  // send a MERKLE_ROOT with payload to a single peer (used for joiner snapshot)
  async function sendRootToPeer(peerId: string, boardId: string | undefined, node: Node) {
    if (!peerId) throw new Error('peerId required')
    const cid = await cidFor(node);
    await dagStore.Put(node);
    // mark seen locally
    seenCids.add(cid);
    const msg: MerkleRootMsg = {
      type: 'MERKLE_ROOT',
      boardId,
      cid,
      ts: Date.now(),
      payload: node,
    };
    // use sendToPeer to target the single peer
    try { sendToPeer(peerId, msg) } catch (e) { /* ignore */ }
    return cid;
  }

  async function onIncomingMessage(msg: MerkleMsg, from?: string) {
    if (!msg || !msg.type) return;
    if (msg.type === 'MERKLE_ROOT') {
      const m = msg as MerkleRootMsg;
      onRootAnnounced(m.cid, from);
      // if we've already seen this cid, ignore
      if (seenCids.has(m.cid)) return
      // otherwise try to obtain the node (payload may be included)
            if (m.payload) {
        try {
          const ok = await verifyCid(m.payload, m.cid);
          if (ok) {
            await dagStore.Put(m.payload);
            // update heads for newly received payload
            try { updateHeads(m.cid, m.payload) } catch (e) { /* ignore */ }
            seenCids.add(m.cid);
            onNodeReceived(m.payload, from);
            // gossip: forward the root to other peers so it reaches the whole room
            try { broadcastToPeers(m) } catch (e) { /* ignore */ }
          } else {
            // CID mismatch -> request authoritative node
            const reqId = `req-${Date.now()}`;
            const getMsg: GetNodeMsg = { type: 'GET_NODE', boardId: m.boardId, cid: m.cid, requestId: reqId, from };
            broadcastToPeers(getMsg);
          }
        } catch (e) {
          // ignore
        }
      } else {
        // no payload: request node from peers, then gossip the root after fetch
        try {
          const node = await requestNode(m.cid, from);
          if (node) {
            // store and apply
            await dagStore.Put(node);
            // update heads for fetched node
            try { updateHeads(m.cid, node) } catch (e) { /* ignore */ }
            seenCids.add(m.cid);
            onNodeReceived(node, from);
            try { broadcastToPeers(m) } catch (e) { /* ignore */ }
          } else {
            // couldn't fetch, optionally retry later
          }
        } catch (e) {
          // ignore
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
          // update heads for node response
          try { updateHeads(m.cid, m.node) } catch (e) { /* ignore */ }
          if (!seenCids.has(m.cid)) {
            seenCids.add(m.cid);
            onNodeReceived(m.node, from);
            // gossip the MERKLE_ROOT with payload so other peers learn as well
            try { broadcastToPeers({ type: 'MERKLE_ROOT', boardId: m.boardId, cid: m.cid, ts: Date.now(), payload: m.node }) } catch (e) { /* ignore */ }
          }
          // resolve pending requests for this cid
          const resolver = pendingRequests.get(m.cid);
          if (resolver) {
            resolver(m.node);
            pendingRequests.delete(m.cid);
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }

  // Request a node from peers and wait for NODE_RESPONSE (with timeout)
  async function requestNode(cid: string, fromPeer?: string, timeout = 5000): Promise<Node | null> {
    // if already local
    const local = await dagStore.Get(cid);
    if (local) return local;
    return await new Promise<Node | null>((resolve) => {
      // set resolver
      pendingRequests.set(cid, resolve);
      const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const getMsg: GetNodeMsg = { type: 'GET_NODE', boardId: undefined, cid, requestId: reqId, from: undefined };
      if (fromPeer) sendToPeer(fromPeer, getMsg);
      else broadcastToPeers(getMsg);
      // timeout
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
    // expose dagStore for convenience
    dagStore,
  };
}
