import { canonicalizeNode } from './canonical';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // use Web Crypto
  const subtle = (globalThis.crypto && (globalThis.crypto as any).subtle) || ((globalThis as any).crypto && (globalThis as any).crypto.subtle);
  const digest = await (subtle as any).digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function cidFor(node: any): Promise<string> {
  const bytes = canonicalizeNode(node);
  const hex = await sha256Hex(bytes);
  // simple CID: hex sha256 prefixed with "cid-"
  return `cid-${hex}`;
}

export async function verifyCid(node: any, cid: string): Promise<boolean> {
  const computed = await cidFor(node);
  return computed === cid;
}
