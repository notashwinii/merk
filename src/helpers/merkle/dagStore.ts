import { Node } from './types';
import { cidFor } from './cid';

const nodeMap: Map<string, Node> = new Map();
const opIndex: Set<string> = new Set();

export async function Put(node: Node): Promise<string> {
  const cid = await cidFor(node);
  nodeMap.set(cid, node);
  if (Array.isArray(node.payload)) {
    for (const op of node.payload) {
      if (op && op.opId) opIndex.add(op.opId);
    }
  }
  return cid;
}

export async function Get(cid: string): Promise<Node | null> {
  return nodeMap.get(cid) || null;
}

export function hasCid(cid: string): boolean {
  return nodeMap.has(cid);
}

export function hasOp(opId: string): boolean {
  return opIndex.has(opId);
}

export function clearStore(): void {
  nodeMap.clear();
  opIndex.clear();
}
