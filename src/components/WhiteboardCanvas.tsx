import React, {useEffect, useState, useRef, useCallback} from 'react'
import { initMerle } from '../helpers/merkle/bootstrap'
import { subscribe as subscribeWB, getState } from '../helpers/whiteboard'

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
    } catch (e) { console.warn(e) }
  }

  const onNodePointerDown = (e: React.PointerEvent, ent: Entity) => {
    (e.target as Element).setPointerCapture(e.pointerId)
    dragRef.current = { id: ent.id, startMouseX: e.clientX, startMouseY: e.clientY, startX: ent.x, startY: ent.y }
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
    }
    const p = panRef.current
    if (p && p.dragging) {
      p.dragging = false
    }
  }

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
      <div style={{display: 'flex', alignItems: 'center', padding: '8px 12px', background: '#0f172a', color: '#fff'}}>
        <h3 style={{margin: 0, marginRight: 12}}>P2P Whiteboard</h3>
        <button onClick={handleAdd} style={{padding: '6px 10px', borderRadius: 6, border: 'none', background: '#06b6d4', color: '#042c3c', cursor: 'pointer'}}>Add entity</button>
        <div style={{marginLeft: 12, color: '#9ca3af'}}>Drag nodes to move. Shift-drag or middle-drag to pan. Scroll to zoom.</div>
      </div>
      <div style={{flex: 1, position: 'relative', background: 'linear-gradient(45deg,#f8fafc 25%, transparent 25%), linear-gradient(-45deg,#f8fafc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #f8fafc 75%), linear-gradient(-45deg, transparent 75%, #f8fafc 75%)', backgroundSize: '40px 40px', backgroundPosition: '0 0, 0 20px, 20px -20px, -20px 0px'}}>
        <svg ref={svgRef} width="100%" height="100%" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel as any} onPointerDown={onBackgroundPointerDown} style={{touchAction: 'none'}}>
          <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
            {entities.map((e) => (
              <g key={e.id} transform={`translate(${e.x},${e.y})`}>
                <rect x={-60} y={-20} rx={8} ry={8} width={120} height={40} fill="#ffffff" stroke="#0f172a" strokeWidth={1} style={{filter: 'drop-shadow(0 2px 6px rgba(2,6,23,0.12))', cursor: 'grab'}} onPointerDown={(ev) => onNodePointerDown(ev, e)} />
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
