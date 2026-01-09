import React, {useEffect, useState, useRef} from 'react'
import { initMerle } from '../helpers/merkle/bootstrap'
import { subscribe as subscribeWB, getState } from '../helpers/whiteboard'

function makeId() { return 'id-' + Math.random().toString(36).slice(2,9) }

export const WhiteboardCanvas: React.FC = () => {
  const [state, setState] = useState(getState())
  const [adapterInitialized, setAdapterInitialized] = useState(false)
  const adapterRef = useRef<any>(null)
  const dragRef = useRef<{id?: string, offsetX?: number, offsetY?: number}>({})

  useEffect(() => {
    const unsub = subscribeWB((s) => setState({...s}))
    return () => unsub()
  }, [])

  useEffect(() => {
    const { adapter } = initMerle()
    adapterRef.current = adapter
    setAdapterInitialized(true)
  }, [])

  const handleAdd = async () => {
    const id = makeId()
    const op = { opId: 'op-' + id, actor: 'me', ts: Date.now(), type: 'ENTITY_CREATE', payload: { id, x: 50 + Math.random()*200, y: 50 + Math.random()*200, label: 'Entity' } }
    // build node and broadcast via adapter helper (ensures IR links to heads)
    try {
      const adapter = adapterRef.current
      if (adapter && typeof adapter.createAndBroadcast === 'function') {
        await adapter.createAndBroadcast(undefined, [op], 'me')
      } else if (adapter) {
        const node = { links: [], payload: [op], meta: { author: 'me', ts: Date.now() } }
        await adapter.broadcastRoot(undefined, node)
      }
    } catch (e) { console.warn(e) }
    // also apply locally via whiteboard module (bootstrap wires adapter->walker to apply for incoming)
  }

  const handleMouseDown = (e: React.MouseEvent, id: string) => {
    const el = (e.target as HTMLElement)
    const rect = el.getBoundingClientRect()
    dragRef.current = { id, offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const onMouseMove = (e: MouseEvent) => {
    const cur = dragRef.current
    if (!cur.id) return
    const id = cur.id
    const x = e.clientX - (cur.offsetX || 0)
    const y = e.clientY - (cur.offsetY || 0)
    // optimistic local update via sending move op as node
    const op = { opId: 'op-' + id + '-' + Date.now(), actor: 'me', ts: Date.now(), type: 'ENTITY_MOVE', payload: { id, x, y } }
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

  const onMouseUp = (e: MouseEvent) => {
    dragRef.current = {}
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  return (
    <div style={{border: '1px solid #ccc', height: 480, position: 'relative'}}>
      <div style={{padding: 8}}>
        <button onClick={handleAdd}>Add entity</button>
      </div>
      <div style={{position: 'relative', width: '100%', height: '420px'}}>
        {Object.values(state.entities).map((e: any) => (
          <div key={e.id}
               onMouseDown={(ev) => handleMouseDown(ev, e.id)}
               style={{position: 'absolute', left: e.x, top: e.y, width: 120, height: 40, border: '1px solid #000', background: '#fff', cursor: 'move', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
            {e.label}
          </div>
        ))}
      </div>
    </div>
  )
}

export default WhiteboardCanvas
