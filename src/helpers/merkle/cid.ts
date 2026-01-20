import { canonicalizeNode } from './canonical';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Use Web Crypto if available (browser). Otherwise fall back to Node's crypto.
  const subtle = (globalThis.crypto && (globalThis.crypto as any).subtle) || ((globalThis as any).crypto && (globalThis as any).crypto.subtle);
  if (subtle && typeof subtle.digest === 'function') {
    const digest = await (subtle as any).digest('SHA-256', bytes);
    const arr = Array.from(new Uint8Array(digest));
    return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Node fallback
  try {
    const nodeCrypto = require('crypto')
    const hash = nodeCrypto.createHash('sha256')
    hash.update(Buffer.from(bytes))
    const buf: Buffer = hash.digest()
    return Array.from(buf).map((b: number) => b.toString(16).padStart(2, '0')).join('')
  } catch (e) {
    throw new Error('No crypto available for sha256')
  }
}

export async function cidFor(node: any): Promise<string> {
  const bytes = canonicalizeNode(node);
  const hex = await sha256Hex(bytes);
  return `cid-${hex}`;
}

export async function verifyCid(node: any, cid: string): Promise<boolean> {
  const computed = await cidFor(node);
  return computed === cid;
}
