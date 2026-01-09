import React, {useEffect, useState, useRef, useCallback} from 'react'
import { initMerle } from '../helpers/merkle/bootstrap'
import { subscribe as subscribeWB, getState } from '../helpers/whiteboard'
import { undo, redo } from '../helpers/whiteboard'
import { message, Tooltip } from 'antd'

function makeId() { return 'id-' + Math.random().toString(36).slice(2,9) }

type Entity = { id: string, x: number, y: number, label: string }

export const WhiteboardCanvas: React.FC = () => {
  const [state, setState] = useState(getState())
  const adapterRef = useRef<any>(null)

  // pan & zoom
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)

  // drag state for nodes
  const dragRef = useRef<{ id?: string, startMouseX?: number, startMouseY?: number, startX?: number, startY?: number }>({})
  // panning state
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
    // convert client coords -> world coords taking pan & scale into account
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
    // show a single moving indicator (use a fixed key so it updates instead of stacking)
    try { message.open({ content: 'Moving...', key: 'wb_move', duration: 0 }) } catch (e) { /* ignore */ }
  }

  // ER features: relation creation mode
  const connectMode = useRef<boolean>(false)
  const connectSource = useRef<string | null>(null)

  const toggleConnectMode = () => {
    connectMode.current = !connectMode.current
    connectSource.current = null
    message.info(connectMode.current ? 'Connect mode: select source entity' : 'Connect mode off')
  }

  const onEntityClick = (ent: Entity) => {
    if (!connectMode.current) return
    if (!connectSource.current) {
      connectSource.current = ent.id
      message.info('Source selected: ' + ent.id + '. Now click target.')
      return
    }
    const source = connectSource.current
    const target = ent.id
    if (source === target) { message.warning('Cannot connect entity to itself'); connectSource.current = null; return }
    // create relation op
    const rid = 'rel-' + Math.random().toString(36).slice(2,9)
    const rel = { id: rid, source, target, label: '', cardinality: '1:N' }
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
  }

  const onEntityDoubleClick = (ent: Entity) => {
    const newLabel = window.prompt('Edit entity label', ent.label)
    if (!newLabel || newLabel === ent.label) return
    const op = { opId: `op-${ent.id}-upd-${Date.now()}`, actor: 'me', ts: Date.now(), type: 'ENTITY_UPDATE', payload: { id: ent.id, label: newLabel } }
    const adapter = adapterRef.current
    if (adapter && typeof adapter.createAndBroadcast === 'function') {
      adapter.createAndBroadcast(undefined, [op], 'me')
    } else if (adapter) {
      const node = { links: [], payload: [op], meta: { author: 'me', ts: Date.now() } }
      adapter.broadcastRoot(undefined, node)
    }
    message.success('Label updated')
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // node dragging
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
      // lightweight feedback handled on pointer up to avoid flooding
      return
    }

    // panning
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
      // finalize moving feedback
      try { message.success({ content: 'Moved', key: 'wb_move', duration: 1.2 }) } catch (err) { /* ignore */ }
    }
    const p = panRef.current
    if (p && p.dragging) {
      p.dragging = false
    }
  }

  // keyboard shortcuts: A = add, Ctrl+Z = undo, Ctrl+Y or Ctrl+Shift+Z = redo, 0 = reset zoom
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'a' || e.key === 'A') {
        handleAdd()
      }
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) { redo(); message.info('Redo') }
        else { undo(); message.info('Undo') }
      }
      if (ctrl && e.key.toLowerCase() === 'y') { redo(); message.info('Redo') }
      if (e.key === '0') { setScale(1); setPan({ x: 0, y: 0 }); message.info('Reset zoom') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleAdd])

  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    // start panning when middle button or space key pressed
    const isPan = e.button === 1 || (e as any).buttons === 4 || (e as any).shiftKey
    if (isPan) {
      panRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y }
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = -e.deltaY
    const factor = delta > 0 ? 1.1 : 0.9
    const newScale = Math.max(0.25, Math.min(4, scale * factor))
    // zoom around mouse pointer
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
      {/* small toolbar (top-left) for common actions */}
      <div style={{position: 'absolute', left: 12, top: 12, zIndex: 1100, display: 'flex', gap: 8}}>
        <Tooltip title="Undo (Ctrl+Z)"><button onClick={() => { undo(); message.info('Undo') }} style={{padding: 8, borderRadius: 6}}>Undo</button></Tooltip>
        <Tooltip title="Redo (Ctrl+Y)"><button onClick={() => { redo(); message.info('Redo') }} style={{padding: 8, borderRadius: 6}}>Redo</button></Tooltip>
        <Tooltip title="Add entity (A)"><button onClick={handleAdd} style={{padding: 8, borderRadius: 6, background: '#06b6d4', color: '#042c3c'}}>Add</button></Tooltip>
        <Tooltip title="Reset zoom (0)"><button onClick={() => { setScale(1); setPan({ x: 0, y: 0 }); message.info('Reset zoom') }} style={{padding: 8, borderRadius: 6}}>Reset</button></Tooltip>
        <Tooltip title="Connect entities"><button onClick={toggleConnectMode} style={{padding: 8, borderRadius: 6, background: connectMode.current ? '#fde68a' : undefined}}>Connect</button></Tooltip>
      </div>
      <div style={{flex: 1, position: 'relative', background: 'linear-gradient(45deg,#f8fafc 25%, transparent 25%), linear-gradient(-45deg,#f8fafc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f8fafc 75%), linear-gradient(-45deg, transparent 75%, #f8fafc 75%)', backgroundSize: '40px 40px', backgroundPosition: '0 0, 0 20px, 20px -20px, -20px 0px'}}>
        <svg ref={svgRef} width="100%" height="100%" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel as any} onPointerDown={onBackgroundPointerDown} style={{touchAction: 'none'}}>
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L10,5 L0,10 z" fill="#334155" />
            </marker>
          </defs>
          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
            {/* draw relations as lines under entities */}
            {Object.values(relations).map((r: any) => {
              const s = (state as any).entities[r.source]
              const t = (state as any).entities[r.target]
              if (!s || !t) return null
              const x1 = s.x, y1 = s.y, x2 = t.x, y2 = t.y
              return (
                <g key={r.id}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#334155" strokeWidth={2} markerEnd="url(#arrow)" />
                  {(r.label || '').length > 0 && <text x={(x1 + x2)/2} y={(y1 + y2)/2 - 6} fontSize={12} textAnchor="middle" fill="#374151">{r.label}</text>}
                </g>
              )
            })}

            {/* entity nodes */}
            {entities.map((e) => (
              <g key={e.id} transform={`translate(${e.x},${e.y})`}>
                <rect x={-60} y={-20} rx={8} ry={8} width={120} height={40} fill="#ffffff" stroke="#0f172a" strokeWidth={1} style={{filter: 'drop-shadow(0 2px 6px rgba(2,6,23,0.12))', cursor: 'grab'}} onPointerDown={(ev) => onNodePointerDown(ev, e)} onClick={() => onEntityClick(e)} onDoubleClick={() => onEntityDoubleClick(e)} />
                <text x={0} y={6} fontSize={12} fontFamily='Arial' textAnchor='middle' fill='#0f172a'>{e.label}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}

export default WhiteboardCanvas
