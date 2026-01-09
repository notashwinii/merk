import { Node } from './types';

function isPlainObject(v: any): boolean {
  return Object.prototype.toString.call(v) === '[object Object]';
}

function canonicalizeValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    return v.map(canonicalizeValue);
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v).sort();
    const obj: any = {};
    for (const k of keys) {
      obj[k] = canonicalizeValue(v[k]);
    }
    return obj;
  }
  return v;
}

export function canonicalString(obj: any): string {
  const val = canonicalizeValue(obj);
  return JSON.stringify(val);
}

export function canonicalize(obj: any): Uint8Array {
  const s = canonicalString(obj);
  return new TextEncoder().encode(s);
}

export function canonicalizeNode(node: Node): Uint8Array {
  const copy: any = {
    links: (node.links || []).slice().sort(),
    payload: node.payload ? node.payload.slice() : [],
    meta: node.meta || {},
  };
  if (Array.isArray(copy.payload)) {
    copy.payload.sort((a: any, b: any) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      return (a.opId || '') < (b.opId || '') ? -1 : 1;
    });
  }
  return canonicalize(copy);
}
