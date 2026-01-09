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

  async function broadcastRoot(boardId: string | undefined, node?: Node) {
    if (!node) throw new Error('node required for broadcastRoot in payload-in-broadcast mode');
    const cid = await cidFor(node);
    // store locally
    await dagStore.Put(node);
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

  async function onIncomingMessage(msg: MerkleMsg, from?: string) {
    if (!msg || !msg.type) return;
    if (msg.type === 'MERKLE_ROOT') {
      const m = msg as MerkleRootMsg;
      onRootAnnounced(m.cid, from);
      if (m.payload) {
        // verify and store
        try {
          const ok = await verifyCid(m.payload, m.cid);
          if (ok) {
            await dagStore.Put(m.payload);
            onNodeReceived(m.payload, from);
          } else {
            // CID mismatch; ignore or request node
            // fallback: request node
            const reqId = `req-${Date.now()}`;
            const getMsg: GetNodeMsg = { type: 'GET_NODE', boardId: m.boardId, cid: m.cid, requestId: reqId, from };
            broadcastToPeers(getMsg);
          }
        } catch (e) {
          // ignore
        }
      } else {
        // no payload, request node
        const reqId = `req-${Date.now()}`;
        const getMsg: GetNodeMsg = { type: 'GET_NODE', boardId: m.boardId, cid: m.cid, requestId: reqId, from };
        broadcastToPeers(getMsg);
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
          onNodeReceived(m.node, from);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  return {
    broadcastRoot,
    onIncomingMessage,
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
