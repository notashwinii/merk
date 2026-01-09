import React from 'react';
import {Button, Card, Col, Input, Menu, MenuProps, message, Row, Space, Typography, Upload, UploadFile} from "antd";
import {CopyOutlined, UploadOutlined} from "@ant-design/icons";
import {useAppDispatch, useAppSelector} from "./store/hooks";
import {startPeer, stopPeerSession} from "./store/peer/peerActions";
import * as connectionAction from "./store/connection/connectionActions"
import {DataType, PeerConnection} from "./helpers/peer";
import WhiteboardCanvas from "./components/WhiteboardCanvas";
import {useAsyncState} from "./helpers/hooks";

const {Title} = Typography
type MenuItem = Required<MenuProps>['items'][number]

function getItem(
    label: React.ReactNode,
    key: React.Key,
    icon?: React.ReactNode,
    children?: MenuItem[],
    type?: 'group',
): MenuItem {
    return {
        key,
        icon,
        children,
        label,
        type,
    } as MenuItem;
}

export const App: React.FC = () => {

    const peer = useAppSelector((state) => state.peer)
    const connection = useAppSelector((state) => state.connection)
    const dispatch = useAppDispatch()

    const handleStartSession = () => {
        dispatch(startPeer())
    }

    const handleStopSession = async () => {
        await PeerConnection.closePeerSession()
        dispatch(stopPeerSession())
    }

    const handleConnectOtherPeer = () => {
        connection.id != null ? dispatch(connectionAction.connectPeer(connection.id || "")) : message.warning("Please enter ID")
    }

    const [fileList, setFileList] = useAsyncState([] as UploadFile[])
    const [sendLoading, setSendLoading] = useAsyncState(false)

    const handleUpload = async () => {
        if (fileList.length === 0) {
            message.warning("Please select file")
            return
        }
        if (!connection.selectedId) {
            message.warning("Please select a connection")
            return
        }
        try {
            await setSendLoading(true);
            let file = fileList[0] as unknown as File;
            let blob = new Blob([file], {type: file.type});

            await PeerConnection.sendConnection(connection.selectedId, {
                dataType: DataType.FILE,
                file: blob,
                fileName: file.name,
                fileType: file.type
            })
            await setSendLoading(false)
            message.info("Send file successfully")
        } catch (err) {
            await setSendLoading(false)
            console.log(err)
            message.error("Error when sending file")
        }
    }

    if (!peer.started) {
        return (
            <div style={{height: '100vh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                <Button size="large" type="primary" onClick={handleStartSession} loading={peer.loading}>Start</Button>
            </div>
        )
    }

    return (
        <div style={{height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden'}}>
            <WhiteboardCanvas />

            <div style={{position: 'fixed', top: 12, right: 12, zIndex: 1200, display: 'flex', flexDirection: 'column', gap: 8}}>
                <div style={{background: 'rgba(15,23,42,0.9)', color: '#fff', padding: 8, borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center'}}>
                    {!peer.started ? (
                        <Button onClick={handleStartSession} loading={peer.loading}>Start</Button>
                    ) : (
                        <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
                            <div style={{fontSize: 12}}>ID: <span style={{fontWeight: 600}}>{peer.id}</span></div>
                            <Button icon={<CopyOutlined/>} onClick={async () => {
                                await navigator.clipboard.writeText(peer.id || "")
                                message.info("Copied: " + peer.id)
                            }}/>
                            <Button danger onClick={handleStopSession}>Stop</Button>
                        </div>
                    )}
                </div>

                <div style={{background: 'rgba(255,255,255,0.95)', padding: 8, borderRadius: 8, boxShadow: '0 6px 18px rgba(2,6,23,0.12)'}}>
                    <Space>
                        <Input placeholder={"Peer ID"}
                               value={connection.id || ''}
                               onChange={e => dispatch(connectionAction.changeConnectionInput(e.target.value))}
                               style={{width: 160}}
                        />
                        <Button onClick={handleConnectOtherPeer} loading={connection.loading}>Connect</Button>
                    </Space>
                </div>

                <div style={{background: 'rgba(255,255,255,0.95)', padding: 8, borderRadius: 8, minWidth: 240}}>
                    {connection.list.length === 0 ? (
                        <div style={{fontSize: 13, color: '#6b7280'}}>Waiting for connection …</div>
                    ) : (
                        <Menu selectedKeys={connection.selectedId ? [connection.selectedId] : []}
                              onSelect={(item) => dispatch(connectionAction.selectItem(item.key))}
                              items={connection.list.map(e => getItem(e, e, null))} />
                    )}
                </div>
            </div>
        </div>
    )
}

export default App
