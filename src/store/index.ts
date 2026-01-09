import {configureStore} from '@reduxjs/toolkit'
import {PeerReducer} from "./peer/peerReducer";
import {ConnectionReducer} from "./connection/connectionReducer";

export const store = configureStore({
    reducer: {
        peer: PeerReducer,
        connection: ConnectionReducer
    }
})

window.store = store

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
