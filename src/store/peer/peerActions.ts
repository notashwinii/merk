import {PeerActionType} from "./peerTypes";
import {Dispatch} from "redux";
import {DataType, PeerConnection} from "../../helpers/peer";
import {message} from "antd";
import {addConnectionList, removeConnectionList} from "../connection/connectionActions";
import download from "js-file-download";
import { getState as getWBState } from '../../helpers/whiteboard'

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
        PeerConnection.onIncomingConnection((conn) => {
            const peerId = conn.peer
            message.info("Incoming connection: " + peerId)
            dispatch(addConnectionList(peerId))
            // send current whiteboard snapshot to the incoming peer so they get existing entities
            try {
                const wbState = getWBState()
                PeerConnection.sendConnection(peerId, { dataType: DataType.OTHER, message: JSON.stringify({ type: 'WB_SNAPSHOT', state: wbState }) })
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


