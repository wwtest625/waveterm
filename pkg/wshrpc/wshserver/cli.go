// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
)

func runCLI(ctx context.Context, connName string, cliName string, args []string) (string, string, error) {
	if conncontroller.IsLocalConnName(connName) {
		return runLocalCLI(ctx, cliName, args)
	}
	if conncontroller.IsWslConnName(connName) {
		distroName := strings.TrimPrefix(connName, "wsl://")
		if err := wslconn.EnsureConnection(ctx, distroName); err != nil {
			return "", "", err
		}
		conn := wslconn.GetWslConn(distroName)
		if conn == nil {
			return "", "", fmt.Errorf("wsl connection not found: %s", connName)
		}
		client := conn.GetClient()
		if client == nil {
			return "", "", fmt.Errorf("wsl client unavailable: %s", connName)
		}
		return runShellCLI(ctx, genconn.MakeWSLShellClient(client), cliName, args)
	}

	if err := conncontroller.EnsureConnection(ctx, connName); err != nil {
		return "", "", err
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return "", "", fmt.Errorf("invalid ssh connection %q: %w", connName, err)
	}
	conn := conncontroller.GetConn(connOpts)
	if conn == nil {
		return "", "", fmt.Errorf("ssh connection not found: %s", connName)
	}
	client := conn.GetClient()
	if client == nil {
		return "", "", fmt.Errorf("ssh client unavailable: %s", connName)
	}
	return runShellCLI(ctx, genconn.MakeSSHShellClient(client), cliName, args)
}

func runLocalCLI(ctx context.Context, cliName string, args []string) (string, string, error) {
	cmd := exec.CommandContext(ctx, cliName, args...)
	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	err := cmd.Run()
	return stdoutBuf.String(), stderrBuf.String(), err
}

func runShellCLI(ctx context.Context, client genconn.ShellClient, cliName string, args []string) (string, string, error) {
	return genconn.RunSimpleCommand(ctx, client, genconn.CommandSpec{
		Cmd: buildShellCommand(cliName, args),
	})
}

func buildShellCommand(cliName string, args []string) string {
	var b strings.Builder
	b.WriteString(cliName)
	for _, arg := range args {
		b.WriteByte(' ')
		b.WriteString(shellutil.HardQuote(arg))
	}
	return b.String()
}
