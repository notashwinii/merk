export interface Op {
  opId: string;
  actor: string;
  ts: number;
  type: string;
  payload: any;
  deps?: string[];
}

export interface Node {
  links: string[];
  payload: Op[];
  meta?: {
    boardId?: string;
    author?: string;
    ts?: number;
    version?: number;
  };
}

export interface MerkleRootMsg {
  type: 'MERKLE_ROOT';
  boardId?: string;
  cid: string;
  ts: number;
  from?: string;
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
