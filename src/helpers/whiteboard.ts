type Entity = {
  id: string;
  x: number;
  y: number;
  label: string;
}

type Relation = {
  id: string;
  source: string;
  target: string;
  label?: string;
  cardinality?: string;
}

const state: { entities: Record<string, Entity>, relations: Record<string, Relation> } = { entities: {}, relations: {} }

const undoStack: Array<Record<string, Entity>> = []
const redoStack: Array<Record<string, Entity>> = []

type Listener = (s: typeof state) => void
const listeners: Listener[] = []

export function subscribe(fn: Listener) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i>=0) listeners.splice(i,1) } }

function emit() { for (const l of listeners) l(state) }

export async function applyOp(op: any) {
  try {
    undoStack.push(JSON.parse(JSON.stringify(state.entities)))
    redoStack.length = 0
  } catch (e) {
  }
  const t = op.type
  if (t === 'ENTITY_CREATE') {
    const e = op.payload
    state.entities[e.id] = { id: e.id, x: e.x, y: e.y, label: e.label }
    emit()
  } else if (t === 'ENTITY_UPDATE') {
    const { id, label } = op.payload
    const e = state.entities[id]
    if (e) { e.label = label; emit() }
  } else if (t === 'ENTITY_ADD_ATTR') {
    const { id, attr } = op.payload
    const e = state.entities[id]
    if (e) { e.label = e.label + ' • ' + attr; emit() }
  } else if (t === 'RELATION_CREATE') {
    const r = op.payload as Relation
    state.relations[r.id] = { ...r }
    emit()
  } else if (t === 'RELATION_DELETE') {
    const { id } = op.payload
    delete state.relations[id]
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
  redoStack.push(JSON.parse(JSON.stringify(state.entities)))
  state.entities = JSON.parse(JSON.stringify(snapshot))
  emit()
  return true
}

export function redo() {
  if (redoStack.length === 0) return false
  const snapshot = redoStack.pop() as Record<string, Entity>
  undoStack.push(JSON.parse(JSON.stringify(state.entities)))
  state.entities = JSON.parse(JSON.stringify(snapshot))
  emit()
  return true
}

export function getState() { return state }

export function applySnapshot(snapshot: { entities: Record<string, Entity> }) {
  state.entities = { ...snapshot.entities }
  if ((snapshot as any).relations) state.relations = { ...((snapshot as any).relations) }
  undoStack.length = 0
  redoStack.length = 0
  emit()
}

export function getRelations() { return state.relations }
