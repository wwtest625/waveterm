# Connections Manager Page Design

## Goal
Provide a standalone visual "Connections Manager" page for SSH/WSL connection management, and add an entry button in the top-left tab bar area (between AI button and tab list area).

## Why
Current workflow relies on dropdown quick-switch + editing `connections.json`. This is powerful but not friendly for operational host management.

## Scope (MVP)
- New block view: `connectionsmanager`
- New top-left tab bar button to open this page
- Manager page features:
  - list existing connections
  - search by host/name/user/address
  - edit basic SSH fields
  - create new connection item
  - test/connect action (`connensure`)
- Save via existing RPC `setconnectionsconfig` (per-host merge write)

## Non-Goals (MVP)
- Full parity with advanced SSH admin panels (proxy chains, groups, tags, bulk ops, audit)
- Multi-step auth wizard
- Full JSON schema editor replacement

## Data Source and Save Strategy
- Source: `fullConfig.connections`
- Save: `RpcApi.SetConnectionsConfigCommand(TabRpcClient, { host, metamaptype })`
- Since backend does per-host merge, MVP updates only provided fields.

## UX
- Header: title + quick actions
- Left: searchable connection list
- Right: edit form for selected/new connection
- Actions: `Test Connection`, `Save`
- Keep "Edit connections.json" affordance for power users

