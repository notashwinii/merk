import React, {useEffect, useState, useRef, useCallback} from 'react'
import { initMerle } from '../helpers/merkle/bootstrap'
import { subscribe as subscribeWB, getState } from '../helpers/whiteboard'
import { undo, redo } from '../helpers/whiteboard'
import type { Entity } from '../helpers/whiteboard'
import { message, Tooltip } from 'antd'

function makeId() { return 'id-' + Math.random().toString(36).slice(2,9) }

export const WhiteboardCanvas: React.FC = () => {
  const [state, setState] = useState(getState())
  const adapterRef = useRef<any>(null)

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  // selected is of form 'entity:<id>' or 'relation:<id>'
  const [selected, setSelected] = useState<string | null>(null)
  const [addAttrMode, setAddAttrMode] = useState<boolean>(false)

  // simple form state for properties panel
  const [propLabel, setPropLabel] = useState<string>('')
  const [propAttrName, setPropAttrName] = useState<string>('')
  const [propAttrType, setPropAttrType] = useState<string>('')
  const [propRelCard, setPropRelCard] = useState<string>('1:N')
  const [propRelCreateFk, setPropRelCreateFk] = useState<boolean>(false)

  const dragRef = useRef<{ id?: string, startMouseX?: number, startMouseY?: number, startX?: number, startY?: number }>({})
  const panRef = useRef<{ dragging?: boolean, startX?: number, startY?: number, startPanX?: number, startPanY?: number }>({})

  useEffect(() => {
    const unsub = subscribeWB((s) => setState({...s}))
    return () => unsub()
  }, [])

  useEffect(() => {
    const { adapter } = initMerle()
    adapterRef.current = adapter
  }, [])

  const entities: Entity[] = Object.values((state as any).entities || {})
  const relations: any = (state as any).relations || {}

  const svgRef = useRef<SVGSVGElement | null>(null)

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    const cx = clientX - (rect?.left || 0)
    const cy = clientY - (rect?.top || 0)
    const worldX = (cx - pan.x) / scale
    const worldY = (cy - pan.y) / scale
    return { x: worldX, y: worldY }
  }, [pan, scale])

  const handleAdd = async () => {
    const id = makeId()
    const x = 100 + Math.random() * 300
    const y = 80 + Math.random() * 240
    const op = { opId: 'op-' + id, actor: 'me', ts: Date.now(), type: 'ENTITY_CREATE', payload: { id, x, y, label: 'Entity' } }
    try {
      const adapter = adapterRef.current
      if (adapter && typeof adapter.createAndBroadcast === 'function') {
        await adapter.createAndBroadcast(undefined, [op], 'me')
      } else if (adapter) {
        const node = { links: [], payload: [op], meta: { author: 'me', ts: Date.now() } }
        await adapter.broadcastRoot(undefined, node)
      }
    } catch (e) { console.warn(e); message.error('Failed to add entity') }
  }

  const onNodePointerDown = (e: React.PointerEvent, ent: Entity) => {
    (e.target as Element).setPointerCapture(e.pointerId)
    dragRef.current = { id: ent.id, startMouseX: e.clientX, startMouseY: e.clientY, startX: ent.x, startY: ent.y }
    try { message.open({ content: 'Moving...', key: 'wb_move', duration: 0 }) } catch (e) { }
  }

  const connectMode = useRef<boolean>(false)
  const connectSource = useRef<string | null>(null)

  const toggleConnectMode = () => {
    connectMode.current = !connectMode.current
    connectSource.current = null
    message.info(connectMode.current ? 'Connect mode: select source entity' : 'Connect mode off')
  }

  const onEntityClick = (ent: Entity) => {
    // priority: add-attribute mode, then connect mode, else selection
  if (addAttrMode) {
      const name = window.prompt('Attribute name')
      if (!name) { setAddAttrMode(false); return }
      const type = window.prompt('Attribute type (optional)') || undefined
      const attrId = 'a-' + Math.random().toString(36).slice(2,9)
      const attr = { id: attrId, name, type, isPrimary: false, isNullable: true }
      const op = { opId: `op-add-attr-${attrId}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_ADD_ATTRIBUTE', payload: { id: ent.id, attr } }
      const adapter = adapterRef.current
      if (adapter && typeof adapter.createAndBroadcast === 'function') adapter.createAndBroadcast(undefined, [op], 'me')
      else if (adapter) adapter.broadcastRoot(undefined, { links: [], payload: [op], meta: { author: 'me', ts: Date.now() } })
      setAddAttrMode(false)
      message.success('Attribute added')
      return
    }

    if (connectMode.current) {
      if (!connectSource.current) {
        connectSource.current = ent.id
        message.info('Source selected: ' + ent.id + '. Now click target.')
        return
      }
      const source = connectSource.current
      const target = ent.id
      if (source === target) { message.warning('Cannot connect entity to itself'); connectSource.current = null; return }
      const rid = 'rel-' + Math.random().toString(36).slice(2,9)
      const rel = { id: rid, source, target, label: '', cardinality: { source: '1', target: 'N' } }
      const op = { opId: 'op-' + rid + '-' + Date.now(), actor: 'me', ts: Date.now(), type: 'RELATION_CREATE', payload: rel }
      const adapter = adapterRef.current
      if (adapter && typeof adapter.createAndBroadcast === 'function') {
        adapter.createAndBroadcast(undefined, [op], 'me')
      } else if (adapter) {
        const node = { links: [], payload: [op], meta: { author: 'me', ts: Date.now() } }
        adapter.broadcastRoot(undefined, node)
      }
      connectSource.current = null
      connectMode.current = false
      message.success('Relation created')
      return
    }

  // normal click selects entity
  setSelected(`entity:${ent.id}`)
  setPropLabel(ent.label || '')
  }

  const onEntityDoubleClick = (ent: Entity) => {
    // double-click now opens properties panel for editing
    setSelected(`entity:${ent.id}`)
    setPropLabel(ent.label || '')
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (d && d.id) {
      const dx = (e.clientX - (d.startMouseX || 0)) / scale
      const dy = (e.clientY - (d.startMouseY || 0)) / scale
      const newX = (d.startX || 0) + dx
      const newY = (d.startY || 0) + dy
      const op = { opId: `op-${d.id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_MOVE', payload: { id: d.id, x: Math.round(newX), y: Math.round(newY) } }
      const adapter = adapterRef.current
      if (adapter) {
        if (typeof adapter.createAndBroadcast === 'function') {
          adapter.createAndBroadcast(undefined, [op], 'me')
        } else {
          const node = { links: [], payload: [op], meta: { author: 'me', ts: Date.now() } }
          adapter.broadcastRoot(undefined, node)
        }
      }
      return
    }

    const p = panRef.current
    if (p && p.dragging) {
      const dx = e.clientX - (p.startX || 0)
      const dy = e.clientY - (p.startY || 0)
      setPan({ x: (p.startPanX || 0) + dx, y: (p.startPanY || 0) + dy })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (d && d.id) {
      dragRef.current = {}
      try { message.success({ content: 'Moved', key: 'wb_move', duration: 1.2 }) } catch (err) { }
    }
    const p = panRef.current
    if (p && p.dragging) {
      p.dragging = false
    }
  }

  const sendOps = async (ops: any[]) => {
    const adapter = adapterRef.current
    try {
      if (adapter && typeof adapter.createAndBroadcast === 'function') {
        await adapter.createAndBroadcast(undefined, ops, 'me')
      } else if (adapter) {
        const node = { links: [], payload: ops, meta: { author: 'me', ts: Date.now() } }
        await adapter.broadcastRoot(undefined, node)
      }
    } catch (e) { console.warn('sendOps error', e) }
  }

  // properties panel actions
  const saveEntityProperties = () => {
    if (!selected || !selected.startsWith('entity:')) return
    const id = selected.split(':')[1]
    const op = { opId: `op-${id}-upd-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_UPDATE', payload: { id, label: propLabel } }
    sendOps([op])
    message.success('Entity updated')
  }

  const addAttributeFromPanel = () => {
    if (!selected || !selected.startsWith('entity:')) return
    const id = selected.split(':')[1]
    if (!propAttrName) return message.warning('Provide attribute name')
    const attrId = 'a-' + Math.random().toString(36).slice(2,9)
    const attr = { id: attrId, name: propAttrName, type: propAttrType || undefined, isPrimary: false, isNullable: true }
    const op = { opId: `op-add-attr-${attrId}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_ADD_ATTRIBUTE', payload: { id, attr } }
    sendOps([op])
    setPropAttrName('')
    setPropAttrType('')
    message.success('Attribute added')
  }

  const saveRelationProperties = () => {
    if (!selected || !selected.startsWith('relation:')) return
    const id = selected.split(':')[1]
    const [src, trg] = propRelCard.split(':')
    const op = { opId: `op-rel-update-${id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'RELATION_UPDATE', payload: { id, label: propLabel, cardinality: { source: src, target: trg } } }
    sendOps([op])
    // Optionally create a foreign key attribute on the N-side that references the 1-side
    try {
      const rel: any = (state as any).relations[id]
      if (propRelCreateFk && rel) {
        // determine which side is N (many). If both N (N:M), skip auto FK creation.
        const card = { source: src, target: trg }
        let fkTargetEntityId: string | null = null
        let refEntityId: string | null = null
        if (card.source === 'N' && card.target === '1') { fkTargetEntityId = rel.source; refEntityId = rel.target }
        else if (card.source === '1' && card.target === 'N') { fkTargetEntityId = rel.target; refEntityId = rel.source }
        if (fkTargetEntityId && refEntityId) {
          const fkId = `fk-${refEntityId}-${Date.now()}`
          const fkName = `fk_${refEntityId}`
          const fkAttr = { id: fkId, name: fkName, type: 'string', isPrimary: false, isNullable: true, isForeign: true, references: { entityId: refEntityId } }
          const fkOp = { opId: `op-add-attr-${fkId}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_ADD_ATTRIBUTE', payload: { id: fkTargetEntityId, attr: fkAttr } }
          // send both relation update and fk add
          sendOps([fkOp])
        }
      }
    } catch (e) { console.warn('FK create failed', e) }
    message.success('Relation updated')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // removed: create-entity shortcut (A) per UX request
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) { redo(); message.info('Redo') }
        else { undo(); message.info('Undo') }
      }
      if (ctrl && e.key.toLowerCase() === 'y') { redo(); message.info('Redo') }
      if (e.key === '0') { setScale(1); setPan({ x: 0, y: 0 }); message.info('Reset zoom') }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selected) {
          if (selected.startsWith('entity:')) {
            const id = selected.split(':')[1]
            const op = { opId: `op-del-${id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_DELETE', payload: { id } }
            sendOps([op])
            setSelected(null)
            message.success('Entity deleted')
          } else if (selected.startsWith('relation:')) {
            const id = selected.split(':')[1]
            const op = { opId: `op-rel-del-${id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'RELATION_DELETE', payload: { id } }
            sendOps([op])
            setSelected(null)
            message.success('Relation deleted')
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleAdd])

  // Sync the properties panel fields when selection or state changes
  useEffect(() => {
    if (!selected) {
      setPropLabel('')
      setPropAttrName('')
      setPropAttrType('')
      setPropRelCard('1:N')
      return
    }
    if (selected.startsWith('entity:')) {
      const id = selected.split(':')[1]
      const ent: any = (state as any).entities[id]
      if (ent) {
        setPropLabel(ent.label || '')
        setPropAttrName('')
        setPropAttrType('')
        setPropRelCreateFk(false)
      }
    } else if (selected.startsWith('relation:')) {
      const id = selected.split(':')[1]
      const rel: any = (state as any).relations[id]
      if (rel) {
        setPropLabel(rel.label || '')
        setPropRelCard((rel.cardinality && `${rel.cardinality.source}:${rel.cardinality.target}`) || '1:N')
        setPropRelCreateFk(false)
      }
    }
  }, [selected, state])

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    const isPan = e.button === 1 || (e as any).buttons === 4 || (e as any).shiftKey
    if (isPan) {
      panRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y }
    }
  }

  // Export current SVG canvas as PNG image
  const exportAsPng = async () => {
    const svg = svgRef.current
    if (!svg) return
    try {
      const rect = svg.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))

      // clone svg and inline its styles
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('width', String(width))
      clone.setAttribute('height', String(height))

      const serializer = new XMLSerializer()
      const svgString = serializer.serializeToString(clone)
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('2d context unavailable')
          // fill background white
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)
          canvas.toBlob((b) => {
            if (!b) return
            const a = document.createElement('a')
            a.href = URL.createObjectURL(b)
            a.download = 'whiteboard.png'
            document.body.appendChild(a)
            a.click()
            a.remove()
          })
        } catch (e) { console.warn('export png failed', e) }
        URL.revokeObjectURL(url)
      }
      img.onerror = (err) => { console.warn('img load error', err); URL.revokeObjectURL(url) }
      img.src = url
    } catch (e) { console.warn('exportAsPng error', e) }
  }

  // Generate SQL DDL for current diagram and download as .sql
  const exportAsSql = () => {
    const st: any = getState()
    const entities = Object.values(st.entities || {}) as any[]
    const relations = Object.values(st.relations || {}) as any[]

    const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_')
    const mapType = (t?: string) => {
      if (!t) return 'TEXT'
      const tt = t.toLowerCase()
      if (tt.includes('int')) return 'INTEGER'
      if (tt.includes('bool')) return 'BOOLEAN'
      if (tt.includes('char') || tt.includes('text') || tt.includes('string')) return 'TEXT'
      if (tt.includes('date')) return 'DATE'
      if (tt.includes('time')) return 'TIMESTAMP'
      return 'TEXT'
    }

    // helper to find primary attr name for an entity
    const getPrimaryAttr = (ent: any) => {
      const attrs = ent.attributes || []
      const pk = attrs.find((a: any) => a.isPrimary)
      return pk ? pk.name : null
    }

    const statements: string[] = []

    for (const ent of entities) {
      const table = sanitize(ent.label || ent.id)
      const cols: string[] = []
      const pkCols: string[] = []
      if (!ent.attributes || ent.attributes.length === 0) {
        cols.push('id SERIAL PRIMARY KEY')
      } else {
        for (const a of ent.attributes) {
          const col = sanitize(a.name || a.id)
          const type = mapType(a.type)
          const nullable = a.isNullable === false ? 'NOT NULL' : ''
          cols.push(`"${col}" ${type} ${nullable}`)
          if (a.isPrimary) pkCols.push(`"${col}"`)
        }
        if (pkCols.length === 0) {
          cols.unshift('id SERIAL PRIMARY KEY')
        }
      }
      const pkClause = pkCols.length > 0 ? `, PRIMARY KEY (${pkCols.join(', ')})` : ''
      const stmt = `CREATE TABLE "${table}" (\n  ${cols.join(',\n  ')}${pkClause}\n);`
      statements.push(stmt)
    }

    // handle relations: create junction tables for N:M
    for (const r of relations) {
      const cardS = r.cardinality?.source || '1'
      const cardT = r.cardinality?.target || 'N'
      if (cardS === 'N' && cardT === 'N') {
        const leftEnt = st.entities[r.source]
        const rightEnt = st.entities[r.target]
        const table = sanitize(r.label || `rel_${r.id}`)
        const leftPk = getPrimaryAttr(leftEnt) || 'id'
        const rightPk = getPrimaryAttr(rightEnt) || 'id'
        const leftCol = sanitize(leftEnt.label || leftEnt.id) + '_' + leftPk
        const rightCol = sanitize(rightEnt.label || rightEnt.id) + '_' + rightPk
        const stmt = `CREATE TABLE "${table}" (\n  "${leftCol}" INTEGER NOT NULL,\n  "${rightCol}" INTEGER NOT NULL,\n  FOREIGN KEY ("${leftCol}") REFERENCES "${sanitize(leftEnt.label || leftEnt.id)}"("${leftPk}"),\n  FOREIGN KEY ("${rightCol}") REFERENCES "${sanitize(rightEnt.label || rightEnt.id)}"("${rightPk}")\n);`
        statements.push(stmt)
      }
    }

    // add FK constraints from attributes
    for (const ent of entities) {
      for (const a of ent.attributes || []) {
        if (a.isForeign && a.references && a.references.entityId) {
          const table = sanitize(ent.label || ent.id)
          const col = sanitize(a.name || a.id)
          const refEnt = st.entities[a.references.entityId]
          if (!refEnt) continue
          const refTable = sanitize(refEnt.label || refEnt.id)
          const refCol = getPrimaryAttr(refEnt) || 'id'
          const stmt = `ALTER TABLE "${table}" ADD FOREIGN KEY ("${col}") REFERENCES "${refTable}"("${refCol}");`
          statements.push(stmt)
        }
      }
    }

    const sql = statements.join('\n\n')
    const blob = new Blob([sql], { type: 'text/sql' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'whiteboard.sql'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = -e.deltaY
    const factor = delta > 0 ? 1.1 : 0.9
    const newScale = Math.max(0.25, Math.min(4, scale * factor))
    const rect = svgRef.current?.getBoundingClientRect()
    const cx = e.clientX - (rect?.left || 0)
    const cy = e.clientY - (rect?.top || 0)
    const worldBefore = { x: (cx - pan.x) / scale, y: (cy - pan.y) / scale }
    const newPanX = cx - worldBefore.x * newScale
    const newPanY = cy - worldBefore.y * newScale
    setScale(newScale)
    setPan({ x: newPanX, y: newPanY })
  }

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%'}}>
      <div style={{flex: 1, position: 'relative', display: 'flex'}}>
        {/* Properties panel (left) */}
        <div style={{width: 320, boxSizing: 'border-box', borderRight: '1px solid #e6e6e6', background: '#ffffff', padding: 12, height: '100%', overflowY: 'auto'}}>
          <h3 style={{marginTop: 2, marginBottom: 10, fontSize: 18}}>Properties</h3>
            {/* Toolbar inside left panel */}
            <div style={{display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap'}}>
              <Tooltip title="Undo (Ctrl+Z)"><button onClick={() => { undo(); message.info('Undo') }} style={{padding: '6px 10px', borderRadius: 6, minWidth: 64, background: '#f3f4f6', border: '1px solid #cbd5e1'}}>Undo</button></Tooltip>
              <Tooltip title="Redo (Ctrl+Y)"><button onClick={() => { redo(); message.info('Redo') }} style={{padding: '6px 10px', borderRadius: 6, minWidth: 64, background: '#f3f4f6', border: '1px solid #cbd5e1'}}>Redo</button></Tooltip>
              <Tooltip title="Add entity"><button onClick={handleAdd} style={{padding: '6px 12px', borderRadius: 6, minWidth: 64, background: '#06b6d4', color: '#042c3c', border: 'none'}}>Add</button></Tooltip>
              <Tooltip title="Reset zoom (0)"><button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); message.info('Reset zoom') }} style={{padding: '6px 10px', borderRadius: 6, minWidth: 64, background: '#f3f4f6', border: '1px solid #cbd5e1'}}>Reset</button></Tooltip>
              <Tooltip title="Export PNG"><button onClick={async () => { await exportAsPng() }} style={{padding: '6px 10px', borderRadius: 6, minWidth: 80, background: '#111827', color: '#ffffff', border: 'none'}}>Export PNG</button></Tooltip>
              <Tooltip title="Export SQL"><button onClick={() => { exportAsSql() }} style={{padding: '6px 10px', borderRadius: 6, minWidth: 80, background: '#10b981', color: '#042c3c', border: 'none'}}>Export SQL</button></Tooltip>
            </div>
            <div style={{display: 'flex', gap: 8, marginBottom: 12}}>
              <Tooltip title={addAttrMode ? "Click an entity to add attribute (active)" : "Add attribute to entity"}><button onClick={() => { setAddAttrMode(v => !v); if (!addAttrMode) message.info('Add-attribute mode: click an entity'); else message.info('Add-attribute mode off') }} style={{padding: '6px 10px', borderRadius: 6, minWidth: 88, background: addAttrMode ? '#fde68a' : '#f3f4f6', border: '1px solid #cbd5e1'}}>Add Attr</button></Tooltip>
              <Tooltip title="Connect entities"><button onClick={toggleConnectMode} style={{padding: '6px 10px', borderRadius: 6, minWidth: 88, background: connectMode.current ? '#fde68a' : '#f3f4f6', border: '1px solid #cbd5e1'}}>Connect</button></Tooltip>
            </div>

            {!selected && <div style={{color: '#6b7280', marginBottom: 8}}>Select an entity or relation to edit</div>}
          {selected && selected.startsWith('entity:') && (() => {
            const id = selected.split(':')[1]
            const ent: any = (state as any).entities[id]
            if (!ent) return <div>Entity not found</div>
            return (
              <div>
                <div style={{marginBottom: 6}}><strong style={{fontSize: 14}}>Entity</strong> <div style={{fontSize: 12, color: '#6b7280', display: 'inline-block', marginLeft: 8}}>— {ent.id}</div></div>
                <label style={{display: 'block', fontSize: 12, color: '#374151', marginTop: 6}}>Label</label>
                <input value={propLabel} onChange={(e) => setPropLabel(e.target.value)} style={{width: '100%', padding: '8px 10px', marginBottom: 8, borderRadius: 4, border: '1px solid #e5e7eb', boxSizing: 'border-box', lineHeight: '20px'}} />
                <button onClick={saveEntityProperties} style={{padding: '8px 12px', borderRadius: 6, background: '#06b6d4', color: '#042c3c', border: 'none'}}>Save</button>

                <hr style={{margin: '12px 0', border: 'none', borderTop: '1px solid #eef2f7'}} />
                <div style={{fontSize: 13, marginBottom: 6}}><strong>Attributes</strong></div>
                <div style={{display: 'flex', gap: 8}}>
                  <input placeholder='name' value={propAttrName} onChange={(e) => setPropAttrName(e.target.value)} style={{flex: 1, padding: '8px 10px', borderRadius: 4, border: '1px solid #e5e7eb', boxSizing: 'border-box', lineHeight: '20px'}} />
                  <input placeholder='type' value={propAttrType} onChange={(e) => setPropAttrType(e.target.value)} style={{width: 100, padding: '8px 10px', borderRadius: 4, border: '1px solid #e5e7eb', boxSizing: 'border-box', lineHeight: '20px'}} />
                </div>
                <div style={{marginTop: 8, display: 'flex', gap: 8}}>
                  <button onClick={addAttributeFromPanel} style={{padding: '6px 10px', borderRadius: 6}}>Add</button>
                </div>
                <div style={{marginTop: 12}}>
                  {(ent.attributes || []).map((a: any) => (
                    <div key={a.id} style={{display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6'}}>
                      <div>
                        <div style={{fontSize: 13}}>{a.isForeign ? 'FK ' : ''}{a.name}{a.type ? `: ${a.type}` : ''}</div>
                        <div style={{fontSize: 11, color: '#6b7280'}}>{a.isPrimary ? 'Primary' : ''} {a.isForeign ? ' • Foreign' : ''}</div>
                      </div>
                              <div style={{display: 'flex', gap: 8}}>
                                <button onClick={() => { const op = { opId: `op-togglepk-${a.id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_TOGGLE_PK', payload: { id: ent.id, attrId: a.id } }; sendOps([op]) }} style={{padding: 6, background: a.isPrimary ? '#06b6d4' : undefined, color: a.isPrimary ? '#042c3c' : undefined}}>PK</button>
                                <button onClick={() => {
                                  const updatedAttr = { ...a, isForeign: !a.isForeign }
                                  const removeOp = { opId: `op-remove-attr-${a.id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_REMOVE_ATTRIBUTE', payload: { id: ent.id, attrId: a.id } }
                                  const addOp = { opId: `op-add-attr-${a.id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_ADD_ATTRIBUTE', payload: { id: ent.id, attr: updatedAttr } }
                                  sendOps([removeOp, addOp])
                                }} style={{padding: 6, background: a.isForeign ? '#f97316' : undefined, color: a.isForeign ? '#071c1f' : undefined}}>FK</button>
                                <button onClick={() => { const op = { opId: `op-remove-attr-${a.id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_REMOVE_ATTRIBUTE', payload: { id: ent.id, attrId: a.id } }; sendOps([op]) }} style={{padding: 6}}>Delete</button>
                              </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {selected && selected.startsWith('relation:') && (() => {
            const id = selected.split(':')[1]
            const rel: any = (state as any).relations[id]
            if (!rel) return <div>Relation not found</div>
            return (
              <div>
                <div style={{marginBottom: 8}}><strong>Relation</strong> — {rel.id}</div>
                <label style={{display: 'block', fontSize: 12, color: '#374151'}}>Label</label>
                <input value={propLabel} onChange={(e) => setPropLabel(e.target.value)} style={{width: '100%', padding: '8px 10px', marginBottom: 8, borderRadius: 4, border: '1px solid #e5e7eb', boxSizing: 'border-box', lineHeight: '20px'}} />
                <label style={{display: 'block', fontSize: 12, color: '#374151'}}>Cardinality</label>
                <select value={propRelCard} onChange={(e) => setPropRelCard(e.target.value)} style={{width: '100%', padding: '8px 10px', marginBottom: 8, boxSizing: 'border-box'}}>
                  <option value='1:1'>1:1</option>
                  <option value='1:N'>1:N</option>
                  <option value='N:1'>N:1</option>
                  <option value='N:M'>N:M</option>
                </select>
                <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8}}>
                  <input id={`fkcreate-${id}`} type='checkbox' checked={propRelCreateFk} onChange={(e) => setPropRelCreateFk(e.target.checked)} />
                  <label htmlFor={`fkcreate-${id}`} style={{fontSize: 13, color: '#374151'}}>Create FK on many-side</label>
                </div>
                <div style={{display: 'flex', gap: 8}}>
                  <button onClick={saveRelationProperties} style={{padding: '8px 12px', borderRadius: 6}}>Save</button>
                </div>
              </div>
            )
          })()}
        </div>

        <div style={{flex: 1, position: 'relative', background: 'linear-gradient(45deg,#f8fafc 25%, transparent 25%), linear-gradient(-45deg,#f8fafc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f8fafc 75%), linear-gradient(-45deg, transparent 75%, #f8fafc 75%)', backgroundSize: '40px 40px', backgroundPosition: '0 0, 0 20px, 20px -20px, -20px 0px'}}>
          <svg ref={svgRef} width="100%" height="100%" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel as any} onPointerDown={onBackgroundPointerDown} style={{touchAction: 'none'}}>
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L10,5 L0,10 z" fill="#334155" />
              </marker>
            </defs>
            <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
              {Object.values(relations).map((r: any) => {
                const s = (state as any).entities[r.source]
                const t = (state as any).entities[r.target]
                if (!s || !t) return null
                const x1 = s.x, y1 = s.y, x2 = t.x, y2 = t.y
                const mx = (x1 + x2) / 2
                const my = (y1 + y2) / 2
                const cs = r.cardinality ? (r.cardinality.source || '') : ''
                const ct = r.cardinality ? (r.cardinality.target || '') : ''
                return (
                  <g key={r.id} onClick={(ev) => { ev.stopPropagation(); setSelected(`relation:${r.id}`); setPropLabel(r.label || ''); setPropRelCard((r.cardinality && `${r.cardinality.source}:${r.cardinality.target}`) || '1:N') }}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#334155" strokeWidth={2} markerEnd="url(#arrow)" />
                    {(r.label || '').length > 0 && <text x={mx} y={my - 6} fontSize={12} textAnchor="middle" fill="#374151">{r.label}</text>}
                    {cs.length > 0 && <text x={x1 + (mx - x1) * 0.2} y={y1 + (my - y1) * 0.2 - 6} fontSize={11} textAnchor="middle" fill="#0f172a">{cs}</text>}
                    {ct.length > 0 && <text x={x2 + (mx - x2) * 0.2} y={y2 + (my - y2) * 0.2 - 6} fontSize={11} textAnchor="middle" fill="#0f172a">{ct}</text>}
                  </g>
                )
              })}

              {entities.map((e) => {
                const attrs = ((state as any).entities || {})[e.id]?.attributes || []
                const attrCount = attrs.length
                const baseW = e.width || 140
                const baseH = e.height || 40
                const height = baseH + Math.max(0, attrCount) * 18
                const rectX = -baseW / 2
                const rectY = -height / 2
                const isSelected = selected === `entity:${e.id}`
                return (
                  <g key={e.id} transform={`translate(${e.x},${e.y})`}>
                    <rect x={rectX} y={rectY} rx={8} ry={8} width={baseW} height={height} fill={isSelected ? '#f8fafc' : '#ffffff'} stroke={isSelected ? '#0ea5a3' : '#0f172a'} strokeWidth={isSelected ? 2 : 1} style={{filter: 'drop-shadow(0 2px 6px rgba(2,6,23,0.08))', cursor: 'grab'}} onPointerDown={(ev) => onNodePointerDown(ev, e)} onClick={() => onEntityClick(e)} onDoubleClick={() => onEntityDoubleClick(e)} />
                    <text x={0} y={rectY + 18} fontSize={12} fontFamily='Arial' textAnchor='middle' fill='#0f172a' fontWeight='600'>{e.label}</text>
                    {attrs.map((a: any, i: number) => (
                      <g key={a.id} transform={`translate(${-baseW/2 + 8}, ${rectY + 32 + i*18})`}>
                        <text
                          x={0}
                          y={0}
                          fontSize={12}
                          fontFamily='Arial'
                          textAnchor='start'
                          fill='#0f172a'
                          style={{textDecoration: a.isPrimary ? 'underline' : 'none', cursor: 'pointer'}}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            const choice = window.prompt('Toggle: p = primary, f = foreign, c = cancel', 'p')
                            if (!choice) return
                            const adapter = adapterRef.current
                            if (choice.toLowerCase() === 'p') {
                              const op = { opId: `op-togglepk-${a.id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_TOGGLE_PK', payload: { id: e.id, attrId: a.id } }
                              if (adapter && typeof adapter.createAndBroadcast === 'function') adapter.createAndBroadcast(undefined, [op], 'me')
                              else if (adapter) adapter.broadcastRoot(undefined, { links: [], payload: [op], meta: { author: 'me', ts: Date.now() } })
                            } else if (choice.toLowerCase() === 'f') {
                              const updatedAttr = { ...a, isForeign: !a.isForeign }
                              const removeOp = { opId: `op-remove-attr-${a.id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_REMOVE_ATTRIBUTE', payload: { id: e.id, attrId: a.id } }
                              const addOp = { opId: `op-add-attr-${a.id}-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_ADD_ATTRIBUTE', payload: { id: e.id, attr: updatedAttr } }
                              if (adapter && typeof adapter.createAndBroadcast === 'function') adapter.createAndBroadcast(undefined, [removeOp, addOp], 'me')
                              else if (adapter) adapter.broadcastRoot(undefined, { links: [], payload: [removeOp, addOp], meta: { author: 'me', ts: Date.now() } })
                            }
                          }}
                        >{a.isForeign ? 'FK ' : ''}{a.name}{a.type ? `: ${a.type}` : ''}</text>
                      </g>
                    ))}
                  </g>
                )
              })}
            </g>
          </svg>
        </div>

   
        
      </div>
    </div>
  )
}

export default WhiteboardCanvas
