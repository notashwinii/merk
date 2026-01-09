/*
 * Merkle-CRDT types
 */
export interface Op {
  opId: string;
  actor: string;
  ts: number; // epoch ms or lamport
  type: string;
  payload: any;
  deps?: string[];
}

export interface Node {
  links: string[]; // child/root CIDs
  payload: Op[]; // array of ops (batched)
  meta?: {
    boardId?: string;
    author?: string;
    ts?: number;
    version?: number;
  };
}

// Transport envelopes
export interface MerkleRootMsg {
  type: 'MERKLE_ROOT';
  boardId?: string;
  cid: string;
  ts: number;
  from?: string;
  // optional node payload included for low-latency
  payload?: Node;
}

export interface GetNodeMsg {
  type: 'GET_NODE';
  boardId?: string;
  cid: string;
  requestId: string;
  from?: string;
}

export interface NodeResponseMsg {
  type: 'NODE_RESPONSE';
  boardId?: string;
  cid: string;
  node: Node;
  requestId?: string;
  from?: string;
}

export type MerkleMsg = MerkleRootMsg | GetNodeMsg | NodeResponseMsg;
