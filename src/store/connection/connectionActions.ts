import {ConnectionActionType} from "./connectionTypes";
import {Dispatch} from "redux";
import {DataType, PeerConnection} from "../../helpers/peer";
import {message} from "antd";
import download from "js-file-download";

export const changeConnectionInput = (id: string) => ({
    type: ConnectionActionType.CONNECTION_INPUT_CHANGE, id
})

export const setLoading = (loading: boolean) => ({
    type: ConnectionActionType.CONNECTION_CONNECT_LOADING, loading
})
export const addConnectionList = (id: string) => ({
    type: ConnectionActionType.CONNECTION_LIST_ADD, id
})

export const removeConnectionList = (id: string) => ({
    type: ConnectionActionType.CONNECTION_LIST_REMOVE, id
})

export const selectItem = (id: string) => ({
    type: ConnectionActionType.CONNECTION_ITEM_SELECT, id
})

export const connectPeer: (id: string) => (dispatch: Dispatch) => Promise<void>
    = (id: string) => (async (dispatch) => {
    dispatch(setLoading(true))
    try {
        await PeerConnection.connectPeer(id)
        PeerConnection.onConnectionDisconnected(id, () => {
            message.info("Connection closed: " + id)
            dispatch(removeConnectionList(id))
        })
        PeerConnection.onConnectionReceiveData(id, (file) => {
            if (file.dataType === DataType.FILE) {
                message.info("Receiving file " + file.fileName + " from " + id)
                download(file.file || '', file.fileName || "fileName", file.fileType)
            }
        })
        // NOTE: snapshot sending is handled by the incoming-connection handler on the acceptor side
        dispatch(addConnectionList(id))
        // request a snapshot from the peer we just connected to (helps avoid race where acceptor sent before we're ready)
        try {
            PeerConnection.sendConnection(id, { dataType: DataType.OTHER, message: JSON.stringify({ type: 'WB_SNAPSHOT_REQUEST' }) })
        } catch (e) {
            console.warn('snapshot request send error', e)
        }
        dispatch(setLoading(false))
    } catch (err) {
        dispatch(setLoading(false))
        console.log(err)
    }
})


