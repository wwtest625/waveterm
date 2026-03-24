// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wavejwt"
)

func TestWithLocalAgentPathEnv_PrependsExistingPaths(t *testing.T) {
	tmpDir := t.TempDir()
	distBin := filepath.Join(tmpDir, "dist", "bin")
	if err := os.MkdirAll(distBin, 0o755); err != nil {
		t.Fatalf("mkdir dist/bin: %v", err)
	}
	oldWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer os.Chdir(oldWd)
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	basePath := strings.Join([]string{"C:\\base\\bin", "C:\\other"}, string(os.PathListSeparator))
	env := withLocalAgentPathEnv([]string{"Path=" + basePath})
	var got string
	for _, entry := range env {
		if strings.HasPrefix(strings.ToLower(entry), "path=") {
			got = strings.SplitN(entry, "=", 2)[1]
			break
		}
	}
	if got == "" {
		t.Fatalf("expected PATH entry to be present")
	}
	parts := strings.Split(got, string(os.PathListSeparator))
	if len(parts) < 3 {
		t.Fatalf("expected prepended wave paths, got %v", parts)
	}
	if parts[0] != tmpDir {
		t.Fatalf("expected cwd first, got %q", parts[0])
	}
	if parts[1] != distBin {
		t.Fatalf("expected dist/bin second, got %q", parts[1])
	}
	if !strings.Contains(got, basePath) {
		t.Fatalf("expected original PATH to remain, got %q", got)
	}
}

func TestGetLocalAgentExtraPathEntries_IncludesCwdWhenPresent(t *testing.T) {
	tmpDir := t.TempDir()
	oldWd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer os.Chdir(oldWd)
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("chdir: %v", err)
	}
	distBin := filepath.Join(tmpDir, "dist", "bin")
	if err := os.MkdirAll(distBin, 0o755); err != nil {
		t.Fatalf("mkdir dist/bin: %v", err)
	}
	entries := getLocalAgentExtraPathEntries()
	joined := strings.Join(entries, "\n")
	if !strings.Contains(joined, tmpDir) {
		t.Fatalf("expected cwd in entries, got %v", entries)
	}
	if !strings.Contains(joined, distBin) {
		t.Fatalf("expected dist/bin in entries, got %v", entries)
	}
}

func TestMakeLocalAgentJWTEnv_UsesBlockContext(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv(wavebase.WaveDataHomeEnvVar, tmpDir)
	keyPair, err := wavejwt.GenerateKeyPair()
	if err != nil {
		t.Fatalf("generate key pair: %v", err)
	}
	if err := wavejwt.SetPrivateKey(keyPair.PrivateKey); err != nil {
		t.Fatalf("set private key: %v", err)
	}
	req := &PostMessageRequest{BlockId: "block-123"}
	env, err := makeLocalAgentJWTEnv(req)
	if err != nil {
		t.Fatalf("makeLocalAgentJWTEnv returned error: %v", err)
	}
	if len(env) != 1 {
		t.Fatalf("expected one env entry, got %v", env)
	}
	if !strings.HasPrefix(env[0], wavebase.WaveJwtTokenVarName+"=") {
		t.Fatalf("expected WAVETERM_JWT env, got %q", env[0])
	}
}
