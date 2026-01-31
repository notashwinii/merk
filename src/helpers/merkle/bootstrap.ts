import { createMerleAdapter } from './adapter'
import { createWalker } from './walker'
import { PeerConnection, DataType } from '../peer'
import { applyOp, applySnapshot, getState as getWBState } from '../whiteboard'

let adapter: any = null
let walker: any = null

export function initMerle() {
  if (adapter) return { adapter, walker }
  const sendToPeer = async (peerId: string, msg: any) => {
    try {
      await PeerConnection.sendConnection(peerId, { dataType: DataType.OTHER, message: JSON.stringify(msg) })
    } catch (e) {
      console.warn('sendToPeer error', e)
    }
  }
  const broadcastToPeers = (msg: any) => {
    try {
      PeerConnection.broadcastAll({ dataType: DataType.OTHER, message: JSON.stringify(msg) })
    } catch (e) {
      console.warn('broadcastToPeers error', e)
    }
  }
  adapter = createMerleAdapter({ sendToPeer, broadcastToPeers })
  PeerConnection.setOnAnyData((data: any, from: string) => {
    try {
      if (!data || !data.message) return
      const parsed = JSON.parse(data.message)
      if (parsed && parsed.type === 'WB_SNAPSHOT' && parsed.state) {
        try { applySnapshot(parsed.state) } catch (e) { console.warn('applySnapshot error', e) }
        return
      }
      if (parsed && parsed.type === 'WB_SNAPSHOT_REQUEST') {
        try {

          const wbState = getWBState()
          try {
            PeerConnection.sendConnection(from, { dataType: DataType.OTHER, message: JSON.stringify({ type: 'WB_SNAPSHOT', state: wbState }) })
          } catch (e) {
            console.warn('send snapshot error', e)
          }
        } catch (e) {
          console.warn('WB_SNAPSHOT_REQUEST handling error', e)
        }
        return
      }
      if (parsed && parsed.type && ['MERKLE_ROOT','GET_NODE','NODE_RESPONSE'].includes(parsed.type)) {
        adapter.onIncomingMessage(parsed, from)
      }
    } catch (e) {
    }
  })

  walker = createWalker(adapter, { applyOp })
  adapter.onNodeReceived = (node: any, from?: string) => {
    walker.processNode(node)
  }
  adapter.onRootAnnounced = (cid: string, from?: string) => {
    walker.syncRoot(cid, from)
  }

  return { adapter, walker }
}

export function getAdapter() { return adapter }
export function getWalker() { return walker }
