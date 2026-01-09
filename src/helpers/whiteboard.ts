type Entity = {
  id: string;
  x: number;
  y: number;
  label: string;
}

const state: { entities: Record<string, Entity> } = { entities: {} }

type Listener = (s: typeof state) => void
const listeners: Listener[] = []

export function subscribe(fn: Listener) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i>=0) listeners.splice(i,1) } }

function emit() { for (const l of listeners) l(state) }

export async function applyOp(op: any) {
  // simple op applier for POC
  const t = op.type
  if (t === 'ENTITY_CREATE') {
    const e = op.payload
    state.entities[e.id] = { id: e.id, x: e.x, y: e.y, label: e.label }
    emit()
  } else if (t === 'ENTITY_MOVE') {
    const { id, x, y } = op.payload
    const e = state.entities[id]
    if (e) { e.x = x; e.y = y; emit() }
  } else if (t === 'ENTITY_DELETE') {
    const { id } = op.payload
    delete state.entities[id]
    emit()
  }
}

export function getState() { return state }

export function applySnapshot(snapshot: { entities: Record<string, Entity> }) {
  // replace in-memory state with snapshot
  state.entities = { ...snapshot.entities }
  // notify listeners
  emit()
}
