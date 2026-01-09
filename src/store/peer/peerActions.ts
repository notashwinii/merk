import {PeerActionType} from "./peerTypes";
import {Dispatch} from "redux";
import {DataType, PeerConnection} from "../../helpers/peer";
import {message} from "antd";
import {addConnectionList, removeConnectionList} from "../connection/connectionActions";
import download from "js-file-download";
import { getState as getWBState } from '../../helpers/whiteboard'
import { initMerle, getAdapter } from '../../helpers/merkle/bootstrap'

export const startPeerSession = (id: string) => ({
    type: PeerActionType.PEER_SESSION_START, id
})

export const stopPeerSession = () => ({
    type: PeerActionType.PEER_SESSION_STOP,
})
export const setLoading = (loading: boolean) => ({
    type: PeerActionType.PEER_LOADING, loading
})

export const startPeer: () => (dispatch: Dispatch) => Promise<void>
    = () => (async (dispatch) => {
    dispatch(setLoading(true))
    try {
        const id = await PeerConnection.startPeerSession()
        PeerConnection.onIncomingConnection(async (conn) => {
            const peerId = conn.peer
            message.info("Incoming connection: " + peerId)
            dispatch(addConnectionList(peerId))
            // send current whiteboard snapshot to the incoming peer so they get existing entities
                try {
                    // ensure merkle adapter initialized
                    initMerle()
                    const adapter = getAdapter()
                    // give a short moment for any in-flight walker syncs to finish so snapshot includes recently received ops
                    await new Promise((res) => setTimeout(res, 250))
                    const wbState = getWBState()
                    // create a checkpoint node representing current entities as create ops
                    const ops = Object.values(wbState.entities).map((e: any) => ({ opId: `snapshot-${e.id}`, actor: 'snapshot', ts: Date.now(), type: 'ENTITY_CREATE', payload: e }))
                    // build node using adapter so it links to current heads per IR
                    let node: any = { links: [], payload: ops, meta: { author: 'snapshot', ts: Date.now() } }
                    if (adapter && typeof adapter.createNodeFromOps === 'function') {
                      try { node = adapter.createNodeFromOps(ops, 'snapshot') } catch (e) { console.warn('createNodeFromOps error', e) }
                    }
                    // if adapter supports targeted send, use it to send merkle root with payload to the joining peer
                    if (adapter && adapter.sendRootToPeer) {
                        try { await adapter.sendRootToPeer(peerId, undefined, node) } catch (e) { console.warn('sendRootToPeer error', e) }
                    } else {
                        // fallback: send raw snapshot as before
                        PeerConnection.sendConnection(peerId, { dataType: DataType.OTHER, message: JSON.stringify({ type: 'WB_SNAPSHOT', state: wbState }) })
                    }
                } catch (e) {
                    console.warn('send snapshot error', e)
                }
            PeerConnection.onConnectionDisconnected(peerId, () => {
                message.info("Connection closed: " + peerId)
                dispatch(removeConnectionList(peerId))
            })
            PeerConnection.onConnectionReceiveData(peerId, (file) => {
                if (file.dataType === DataType.FILE) {
                    message.info("Receiving file " + file.fileName + " from " + peerId)
                    download(file.file || '', file.fileName || "fileName", file.fileType)
                }
            })
        })
        dispatch(startPeerSession(id))
        dispatch(setLoading(false))
    } catch (err) {
        console.log(err)
        dispatch(setLoading(false))
    }
})


