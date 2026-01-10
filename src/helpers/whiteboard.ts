// Richer ER model
export type Attribute = {
  id: string
  name: string
  type?: string
  isPrimary?: boolean
  isNullable?: boolean
  isForeign?: boolean
  references?: { entityId: string, attrId?: string }
}

export type Entity = {
  id: string
  x: number
  y: number
  label: string
  width?: number
  height?: number
  attributes?: Attribute[]
  weak?: boolean
}

export type Relation = {
  id: string
  source: string
  target: string
  label?: string
  cardinality?: { source?: string, target?: string } // e.g. { source: '1', target: 'N' }
  identifying?: boolean
  attributes?: Attribute[]
}

const state: { entities: Record<string, Entity>, relations: Record<string, Relation> } = { entities: {}, relations: {} }

// store snapshots of the entire state for undo/redo
const undoStack: Array<typeof state> = []
const redoStack: Array<typeof state> = []

// per-entity last-applied timestamp to avoid older ops overwriting newer state
const entityTs: Record<string, number> = {}

type Listener = (s: typeof state) => void
const listeners: Listener[] = []

export function subscribe(fn: Listener) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i>=0) listeners.splice(i,1) } }

function emit() { for (const l of listeners) l(state) }

function snapshotForUndo() {
  try {
    undoStack.push(JSON.parse(JSON.stringify(state)))
    // clear redo on new operation
    redoStack.length = 0
  } catch (e) {
    // ignore
  }
}

export async function applyOp(op: any) {
  const t = op.type
  const opTs = (typeof op.ts === 'number') ? op.ts : Date.now()
  // operations are atomic and recorded for undo
  snapshotForUndo()

  if (t === 'ENTITY_CREATE') {
    const e = op.payload as Entity
    const existing = state.entities[e.id]
    if (!existing) {
      state.entities[e.id] = { id: e.id, x: e.x, y: e.y, label: e.label, width: e.width || 140, height: e.height || 48, attributes: e.attributes ? [...e.attributes] : [] }
      entityTs[e.id] = opTs
    } else {
      // merge without overwriting newer state. Only accept incoming label/attributes if opTs >= known timestamp
      existing.x = e.x ?? existing.x
      existing.y = e.y ?? existing.y
      const last = entityTs[e.id] || 0
      if (opTs >= last) {
        if (e.label !== undefined && e.label !== null) existing.label = e.label
        existing.width = e.width ?? existing.width
        existing.height = e.height ?? existing.height
        const incomingAttrs = (e.attributes || []) as Attribute[]
        existing.attributes = existing.attributes || []
        for (const a of incomingAttrs) {
          if (!existing.attributes.find(x => x.id === a.id)) existing.attributes.push(a)
        }
        entityTs[e.id] = opTs
      } else {
        // incoming op is older than existing known state: only merge non-conflicting fields (positions)
        existing.width = existing.width ?? e.width
        existing.height = existing.height ?? e.height
      }
    }
    emit()
  } else if (t === 'ENTITY_UPDATE') {
    const { id, label } = op.payload
    const e = state.entities[id]
    if (e) {
      const last = entityTs[id] || 0
      if (opTs >= last) {
        e.label = label
        entityTs[id] = opTs
        emit()
      }
    }
  } else if (t === 'ENTITY_ADD_ATTRIBUTE') {
    const { id, attr } = op.payload as { id: string, attr: Attribute }
    const e = state.entities[id]
    if (e) {
      e.attributes = e.attributes || []
      // avoid adding duplicate attributes with same id
      if (!e.attributes.find(a => a.id === attr.id)) {
        e.attributes.push(attr)
        // if incoming attribute is primary, ensure only one primary exists
        if (attr.isPrimary) {
          for (const a of e.attributes) {
            if (a.id !== attr.id) a.isPrimary = false
          }
        }
        entityTs[id] = opTs
        emit()
      }
    }
  } else if (t === 'ENTITY_REMOVE_ATTRIBUTE') {
    const { id, attrId } = op.payload as { id: string, attrId: string }
    const e = state.entities[id]
    if (e && e.attributes) { e.attributes = e.attributes.filter(a => a.id !== attrId); emit() }
  } else if (t === 'ENTITY_TOGGLE_PK') {
    const { id, attrId } = op.payload as { id: string, attrId: string }
    const e = state.entities[id]
    if (e && e.attributes) {
      const a = e.attributes.find(a => a.id === attrId)
      if (a) {
        const newVal = !a.isPrimary
        // if setting primary on, unset others
        if (newVal) {
          for (const other of e.attributes) {
            other.isPrimary = false
          }
        }
        a.isPrimary = newVal
        emit()
      }
    }
  } else if (t === 'RELATION_CREATE') {
    const r = op.payload as Relation
    state.relations[r.id] = { ...r, attributes: r.attributes ? [...r.attributes] : [] }
    emit()
  } else if (t === 'RELATION_UPDATE') {
    const { id, label, cardinality, identifying } = op.payload as { id: string, label?: string, cardinality?: any, identifying?: boolean }
    const r = state.relations[id]
    if (r) { if (label !== undefined) r.label = label; if (cardinality !== undefined) r.cardinality = cardinality; if (identifying !== undefined) r.identifying = identifying; emit() }
  } else if (t === 'RELATION_DELETE') {
    const { id } = op.payload as { id: string }
    delete state.relations[id]
    emit()
  } else if (t === 'ENTITY_MOVE') {
    const { id, x, y } = op.payload as { id: string, x: number, y: number }
    const e = state.entities[id]
    if (e) { e.x = x; e.y = y; emit() }
  } else if (t === 'ENTITY_DELETE') {
    const { id } = op.payload as { id: string }
    // remove relations referencing this entity
    for (const rid of Object.keys(state.relations)) {
      const r = state.relations[rid]
      if (r.source === id || r.target === id) delete state.relations[rid]
    }
    delete state.entities[id]
    emit()
  }
}

export function undo() {
  if (undoStack.length === 0) return false
  const snapshot = undoStack.pop() as typeof state
  redoStack.push(JSON.parse(JSON.stringify(state)))
  state.entities = JSON.parse(JSON.stringify(snapshot.entities))
  state.relations = JSON.parse(JSON.stringify(snapshot.relations))
  emit()
  return true
}

export function redo() {
  if (redoStack.length === 0) return false
  const snapshot = redoStack.pop() as typeof state
  undoStack.push(JSON.parse(JSON.stringify(state)))
  state.entities = JSON.parse(JSON.stringify(snapshot.entities))
  state.relations = JSON.parse(JSON.stringify(snapshot.relations))
  emit()
  return true
}

export function getState() { return state }

export function applySnapshot(snapshot: { entities: Record<string, Entity>, relations?: Record<string, Relation> }) {
  // merge snapshot into current state, set per-entity timestamps to now to mark freshness
  const now = Date.now()
  for (const [id, ent] of Object.entries(snapshot.entities || {})) {
    const existing = state.entities[id]
    if (!existing) {
      state.entities[id] = { ...ent }
    } else {
      // merge attributes and fields, snapshot is considered fresh
      existing.x = ent.x ?? existing.x
      existing.y = ent.y ?? existing.y
      if (ent.label !== undefined && ent.label !== null) existing.label = ent.label
      existing.width = ent.width ?? existing.width
      existing.height = ent.height ?? existing.height
      existing.attributes = existing.attributes || []
      const incomingAttrs = (ent.attributes || []) as Attribute[]
      for (const a of incomingAttrs) {
        if (!existing.attributes.find(x => x.id === a.id)) existing.attributes.push(a)
      }
    }
    entityTs[id] = now
  }
  if (snapshot.relations) state.relations = { ...snapshot.relations }
  undoStack.length = 0
  redoStack.length = 0
  emit()
}

export function getRelations() { return state.relations }

// Utilities for import/export
export function exportJSON() {
  return JSON.stringify(state)
}

export function importJSON(s: string) {
  try {
    const parsed = JSON.parse(s)
    applySnapshot(parsed)
    return true
  } catch (e) {
    return false
  }
}
