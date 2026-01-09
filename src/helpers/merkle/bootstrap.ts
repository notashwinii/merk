import { createMerleAdapter } from './adapter'
import { createWalker } from './walker'
import * as dagStore from './dagStore'
import { PeerConnection, DataType } from '../peer'
import { applyOp, subscribe as subscribeWB } from '../whiteboard'

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
  // wire incoming peer messages to adapter
  PeerConnection.setOnAnyData((data: any, from: string) => {
    try {
      if (!data || !data.message) return
      const parsed = JSON.parse(data.message)
      // forward merkle messages to adapter
      if (parsed && parsed.type && ['MERKLE_ROOT','GET_NODE','NODE_RESPONSE'].includes(parsed.type)) {
        adapter.onIncomingMessage(parsed, from)
      }
    } catch (e) {
      // ignore
    }
  })

  // create walker and wire callbacks
  walker = createWalker(adapter, { applyOp })
  adapter.onNodeReceived = (node: any, from?: string) => {
    // when adapter stores a node and notifies us, ensure walker processes it
    // store done in adapter already; simply sync root for this node
    walker.processNode(node)
  }
  adapter.onRootAnnounced = (cid: string, from?: string) => {
    walker.syncRoot(cid, from)
  }

  return { adapter, walker }
}

export function getAdapter() { return adapter }
export function getWalker() { return walker }
