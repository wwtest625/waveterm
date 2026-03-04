# WaveTerm Secondary Development Environment Status (2026-03-04)

## 1) Local Environment and Dependency Setup

- OS: Windows
- Workspace: `C:\Users\sys49169\Downloads\Github\waveterm`
- Verified tools:
  - `task`: `3.48.0`
  - `go`: `go1.25.6 windows/amd64`
  - `zig`: `0.15.2` (installed via winget)
  - `node`: multiple versions exist on this machine

Executed setup command:

```powershell
task init
```

This completed:
- root `npm install`
- `go mod tidy`
- `docs` subproject `npm install`

## 2) Required Environment Variables and Shell Prep

Two environment issues were found and fixed:

1. `npm_config_ignore_scripts=true` caused Electron install scripts to be skipped.
2. `ELECTRON_RUN_AS_NODE=1` caused Electron to run in Node mode.

Persistent fix applied:
- User env var was updated in registry:
  - `npm_config_ignore_scripts=false`

Recommended shell setup before starting dev:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:npm_config_ignore_scripts='false'
$env:PATH='C:\Users\sys49169\AppData\Local\Microsoft\WinGet\Packages\zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe\zig-x86_64-windows-0.15.2;'+$env:PATH
```

Project docs require Node 22 LTS. To force Node 22 in current shell:

```powershell
$env:PATH="$env:NVM_SYMLINK;$env:PATH"
node -v
npm -v
```

## 3) Dev Server Startup Verification

Verified command:

```powershell
task electron:winquickdev
```

Observed key logs:
- `electron main process built successfully`
- `electron preload scripts built successfully`
- `dev server running ... http://localhost:5173/`
- `starting electron app...`

Conclusion: dev startup chain is functional after env fixes.

## 4) Project Structure, Core Modules, and Tech Stack

### Tech Stack
- Desktop shell: Electron
- Frontend: React 19 + TypeScript + Vite/electron-vite
- State: Jotai
- Terminal UI: XTerm.js
- Editor: Monaco
- Styling: Tailwind CSS v4 (with existing SCSS usage)
- Backend: Go (`cmd/server`, `pkg/*`)
- Build orchestration: Taskfile
- Testing: Vitest + `go test`

### Core Directories
- `emain/`: Electron main process, windowing, IPC, startup
- `frontend/`: renderer UI and app logic
- `cmd/`: Go entrypoints (`server`, `wsh`, generators)
- `pkg/`: core Go packages (`wstore`, `wconfig`, `wcore`, `remote`, `wshrpc`, etc.)
- `db/`: migrations
- `docs/`: Docusaurus docs site
- `Taskfile.yml`: build/run/package task entrypoint

## 5) Test and Quality Status (Current Branch)

### Frontend Unit Tests

```powershell
npx vitest run
```

Status: failed (1 test)
- `frontend/layout/tests/layoutTree.test.ts > layoutTreeStateReducer - compute move`

### TypeScript Type Check

```powershell
task check:ts
```

Status: failed (2 errors)
- `frontend/app/element/streamdown.tsx`: `mermaidConfig` type mismatch
- `frontend/preview/previews/vtabbar.preview.tsx`: missing `priority` in `TabIndicator`

### Go Tests

```powershell
$env:CGO_ENABLED='1'
$env:CC='zig cc -target x86_64-windows-gnu'
go test ./...
```

Status: failed (main failing packages)
- `pkg/aiusechat` (`tools_readdir_test.go` assertion/type conversion failures)
- `pkg/remote/connparse` (path parsing output differs from expected values)

## 6) Current Readiness Summary

- Local dev dependencies are installed and runnable for day-to-day development.
- Dev server startup works with validated command path.
- Current branch is not test-green yet (frontend tests, TS check, and Go tests still failing).
- Environment is ready for secondary development, but failing checks must be fixed before merge/release.
