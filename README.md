# Merk — Collaborative ER Diagram Whiteboard

> Design, share, and iterate Entity-Relationship diagrams in real time using peer-to-peer collaboration.

This repository contains Merk, a lightweight React + TypeScript app that provides a collaborative whiteboard focused on ER diagrams. The app uses peer-to-peer connections so teams can work together without a centralized server.

## Quick start

Prerequisites:

- Node.js (16+ recommended)
- yarn or npm

Install and run in development:

```bash
# install
yarn install

# run dev server
yarn start
```

## What this project is

Merk is a collaboration-first ER diagram whiteboard. Its goals are:

- Enable quick sketching of data models (entities, relationships, attributes).
- Allow real-time collaboration directly between peers (Peer-to-Peer) with no mandatory central server.
- Keep a minimal, extensible codebase so it can be adapted for documentation exports, versioning, or storage backends.

## Features

- Peer-to-peer sessions (PeerJS).
- Drag-and-drop and canvas-based editing (see `src/components/WhiteboardCanvas.tsx`).
- Simple session sharing / copyable peer IDs.
- Modular helpers for managing Merkle-like structures and DAG storage under `src/helpers/merkle`.

