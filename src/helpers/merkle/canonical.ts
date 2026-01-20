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
  // Use native TextEncoder when available (browser or modern runtimes).
  if (typeof (globalThis as any).TextEncoder !== 'undefined') {
    return new (globalThis as any).TextEncoder().encode(s)
  }

  // Fallback: manual UTF-8 encoder to avoid requiring Node polyfills during bundling.
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i)
    if (code < 0x80) {
      out.push(code)
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // surrogate pair
      const hi = code
      const lo = s.charCodeAt(++i)
      const codePoint = 0x10000 + (((hi & 0x3ff) << 10) | (lo & 0x3ff))
      out.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      )
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(out)
}

export function canonicalizeNode(node: Node): Uint8Array {
  const copy: any = {
    links: (node.links || []).slice().sort(),
    payload: node.payload ? node.payload.slice() : [],
    meta: node.meta || {},
  };
  if (Array.isArray(copy.payload)) {
    // Sort payload deterministically without relying on timestamps.
    // Prefer opId if present, otherwise fall back to canonicalized JSON.
    copy.payload.sort((a: any, b: any) => {
      const A = (a && a.opId) ? a.opId : canonicalString(a)
      const B = (b && b.opId) ? b.opId : canonicalString(b)
      if (A < B) return -1
      if (A > B) return 1
      return 0
    })
  }
  return canonicalize(copy);
}
