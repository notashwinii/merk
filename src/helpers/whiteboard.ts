type Entity = {
  id: string;
  x: number;
  y: number;
  label: string;
}

const state: { entities: Record<string, Entity> } = { entities: {} }

// undo/redo stacks: store snapshots of entities
const undoStack: Array<Record<string, Entity>> = []
const redoStack: Array<Record<string, Entity>> = []

type Listener = (s: typeof state) => void
const listeners: Listener[] = []

export function subscribe(fn: Listener) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i>=0) listeners.splice(i,1) } }

function emit() { for (const l of listeners) l(state) }

export async function applyOp(op: any) {
  // simple op applier for POC
  // push pre-op snapshot for undo
  try {
    undoStack.push(JSON.parse(JSON.stringify(state.entities)))
    // clear redo on new op
    redoStack.length = 0
  } catch (e) {
    // ignore
  }
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

export function undo() {
  if (undoStack.length === 0) return false
  const snapshot = undoStack.pop() as Record<string, Entity>
  // push current to redo
  redoStack.push(JSON.parse(JSON.stringify(state.entities)))
  state.entities = JSON.parse(JSON.stringify(snapshot))
  emit()
  return true
}

export function redo() {
  if (redoStack.length === 0) return false
  const snapshot = redoStack.pop() as Record<string, Entity>
  // push current to undo
  undoStack.push(JSON.parse(JSON.stringify(state.entities)))
  state.entities = JSON.parse(JSON.stringify(snapshot))
  emit()
  return true
}

export function getState() { return state }

export function applySnapshot(snapshot: { entities: Record<string, Entity> }) {
  // replace in-memory state with snapshot
  state.entities = { ...snapshot.entities }
  // clear undo/redo when snapshot applied (fresh join)
  undoStack.length = 0
  redoStack.length = 0
  // notify listeners
  emit()
}
