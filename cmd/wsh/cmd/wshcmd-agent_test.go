// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func TestResolveAgentSocketNameUsesWaveDataHomeEnv(t *testing.T) {
	dataHome := t.TempDir()
	t.Setenv(wavebase.WaveDataHomeEnvVar, dataHome)
	if runtime.GOOS == "windows" {
		t.Setenv("LOCALAPPDATA", "")
	}

	sockName := resolveAgentSocketName()
	expected := filepath.Join(dataHome, wavebase.DomainSocketBaseName)
	if sockName != expected {
		t.Fatalf("resolveAgentSocketName() = %q, want %q", sockName, expected)
	}
}

func TestResolveAgentWaveDataHomeUsesLocalAppDataFallback(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("windows-specific fallback")
	}
	t.Setenv(wavebase.WaveDataHomeEnvVar, "")
	localAppData := filepath.Join(t.TempDir(), "Local")
	t.Setenv("LOCALAPPDATA", localAppData)

	dataHome := resolveAgentWaveDataHome()
	expected := filepath.Join(localAppData, "waveterm", "Data")
	if dataHome != expected {
		t.Fatalf("resolveAgentWaveDataHome() = %q, want %q", dataHome, expected)
	}
}

type agentBlocksTestServer struct{}

func (*agentBlocksTestServer) WshServerImpl() {}

func (*agentBlocksTestServer) WorkspaceListCommand(context.Context) ([]wshrpc.WorkspaceInfoData, error) {
	return []wshrpc.WorkspaceInfoData{
		{
			WindowId: "win-1",
			WorkspaceData: &waveobj.Workspace{
				OID: "ws-1",
			},
		},
	}, nil
}

func (*agentBlocksTestServer) BlocksListCommand(context.Context, wshrpc.BlocksListRequest) ([]wshrpc.BlocksListEntry, error) {
	return []wshrpc.BlocksListEntry{
		{
			WindowId:    "win-1",
			WorkspaceId: "ws-1",
			TabId:       "tab-1",
			BlockId:     "block-1",
			Meta: waveobj.MetaMapType{
				waveobj.MetaKey_View:       "term",
				waveobj.MetaKey_Connection: "local",
				waveobj.MetaKey_CmdCwd:     "/tmp/demo",
			},
		},
	}, nil
}

func TestAgentBlocksListRunWithoutJWT(t *testing.T) {
	tempDir := t.TempDir()
	sockPath := filepath.Join(tempDir, wavebase.DomainSocketBaseName)
	_ = os.Remove(sockPath)
	listener, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatalf("listen unix socket: %v", err)
	}
	defer listener.Close()

	prevRouter := wshutil.DefaultRouter
	wshutil.DefaultRouter = wshutil.NewWshRouter()
	wshutil.DefaultRouter.SetAsRootRouter()
	t.Cleanup(func() {
		wshutil.DefaultRouter = prevRouter
	})

	serverRpc := wshutil.MakeWshRpc(wshrpc.RpcContext{RouteId: wshutil.DefaultRoute}, &agentBlocksTestServer{}, "agent-blocks-test")
	if _, err := wshutil.DefaultRouter.RegisterTrustedLeaf(serverRpc, wshutil.DefaultRoute); err != nil {
		t.Fatalf("register trusted leaf: %v", err)
	}
	go wshutil.RunWshRpcOverListener(listener, nil)

	t.Setenv("WAVETERM_JWT", "")
	t.Setenv(wavebase.WaveDataHomeEnvVar, tempDir)

	var stdout bytes.Buffer
	prevStdout := WrappedStdout
	prevRpcClient := RpcClient
	prevRpcContext := RpcContext
	WrappedStdout = &stdout
	RpcClient = nil
	RpcContext = wshrpc.RpcContext{}
	t.Cleanup(func() {
		WrappedStdout = prevStdout
		RpcClient = prevRpcClient
		RpcContext = prevRpcContext
	})

	if err := preRunSetupAgentRpcClient(nil, nil); err != nil {
		t.Fatalf("preRunSetupAgentRpcClient() error: %v", err)
	}
	if err := agentBlocksListRun(nil, nil); err != nil {
		t.Fatalf("agentBlocksListRun() error: %v", err)
	}

	var blocks []agentBlockDetails
	if err := json.Unmarshal(stdout.Bytes(), &blocks); err != nil {
		t.Fatalf("decode output: %v\noutput=%s", err, stdout.String())
	}
	if len(blocks) != 1 {
		t.Fatalf("expected 1 block, got %d", len(blocks))
	}
	if blocks[0].BlockId != "block-1" {
		t.Fatalf("unexpected block id %q", blocks[0].BlockId)
	}
	if blocks[0].Connection != "local" {
		t.Fatalf("unexpected connection %q", blocks[0].Connection)
	}
}

func TestAgentResolveBlockORefFromFlagsWithRawUUID(t *testing.T) {
	prevBlockArg := blockArg
	blockArg = "c25ae369-d19e-42c3-98ec-298372c955f1"
	t.Cleanup(func() {
		blockArg = prevBlockArg
	})

	oref, err := agentResolveBlockORefFromFlags("")
	if err != nil {
		t.Fatalf("agentResolveBlockORefFromFlags() error: %v", err)
	}
	if oref.OType != waveobj.OType_Block {
		t.Fatalf("unexpected otype %q", oref.OType)
	}
	if oref.OID != blockArg {
		t.Fatalf("unexpected oid %q", oref.OID)
	}
}

func TestAgentNormalizeTermLines(t *testing.T) {
	raw := "\u001b[31mhello\u001b[0m\r\nworld\r\n"
	lines := agentNormalizeTermLines(raw)
	data, err := base64.StdEncoding.DecodeString(base64.StdEncoding.EncodeToString([]byte(raw)))
	if err != nil {
		t.Fatalf("roundtrip base64 failed: %v", err)
	}
	if string(data) != raw {
		t.Fatalf("unexpected roundtrip data %q", string(data))
	}
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}
	if lines[0] != "hello" || lines[1] != "world" {
		t.Fatalf("unexpected lines %#v", lines)
	}
}
