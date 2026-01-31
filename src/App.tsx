import React from 'react';
import {Button, Input, Menu, MenuProps, message, Space, Typography} from "antd";
import {CopyOutlined} from "@ant-design/icons";
import {useAppDispatch, useAppSelector} from "./store/hooks";
import {startPeer, stopPeerSession} from "./store/peer/peerActions";
import * as connectionAction from "./store/connection/connectionActions"
import {PeerConnection} from "./helpers/peer";
import WhiteboardCanvas from "./components/WhiteboardCanvas";
// removed unused useAsyncState import

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

    // file upload UI/actions were removed to avoid unused variables; keep peer/file capabilities in `helpers/peer`.

    if (!peer.started) {
        return (
            <div style={{minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f7f9fc', padding: 32}}>
                <div style={{maxWidth: 1000, width: '100%', display: 'flex', gap: 32, alignItems: 'flex-start'}}>
                    <div style={{flex: 1}}>
                        <Title style={{margin: 0, fontSize: 48}}>Merk</Title>
                        <div style={{height: 8}} />
                        <div style={{color: '#374151', fontSize: 18, marginBottom: 12}}>Collaborative ER diagram whiteboard</div>
                        <div style={{marginBottom: 20, color: '#6b7280'}}>Merk lets teams sketch entity-relationship diagrams, collaborate live over peer-to-peer connections, and export models for documentation.</div>

                        <Space size="middle">
                            <Button type="primary" size="large" onClick={handleStartSession} loading={peer.loading}>Open Whiteboard</Button>
                            <Button size="large" onClick={() => window.open('https://github.com/notashwinii/merk', '_blank')}>View on GitHub</Button>
                        </Space>

                        <div style={{height: 18}} />

                        <div style={{display: 'flex', gap: 24, color: '#111827'}}>
                            <div>
                                <strong>Features</strong>
                                <ul style={{margin: '8px 0 0 18px'}}>
                                    <li>Real-time peer-to-peer collaboration</li>
                                    <li>Drag &amp; drop entities, relationships, and attributes</li>
                                    <li>Export diagrams and share session links</li>
                                </ul>
                            </div>
                        </div>
                        <div style={{marginTop: 18}}>
                            <strong>Implementation</strong>
                            <div style={{marginTop: 8, color: '#6b7280', fontSize: 13}}>
                                <p style={{margin: '6px 0'}}>Merk is a single-page React + TypeScript application. Realtime peer-to-peer connectivity is provided by PeerJS, and global UI/state flows use Redux Toolkit.</p>
                                <p style={{margin: '6px 0'}}>Diagram data is organized using a Merkle DAG approach; content is canonicalized, chunked, and referenced by content IDs (CIDs) so changes can be synchronized deterministically without a central server.</p>
                                <p style={{margin: '6px 0'}}>Edits are applied optimistically and broadcast to peers. The DAG walker, canonicalization, and CID utilities allow compact export/import, replay, and deterministic merging of updates.</p>
                            </div>
                        </div>
                    </div>

                   
                </div>
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
