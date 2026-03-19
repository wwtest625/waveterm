// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
)

const tmuxFieldSep = "\t"

func (ws *WshServer) TmuxListSessionsCommand(ctx context.Context, data wshrpc.TmuxListSessionsRequest) (wshrpc.TmuxListSessionsResponse, error) {
	stdout, stderr, err := runTmuxCLI(ctx, data.Connection, tmuxListSessionsArgs())
	if err != nil {
		if isNoTmuxServerError(err, stdout, stderr) {
			return wshrpc.TmuxListSessionsResponse{
				Sessions:      []wshrpc.TmuxSessionSummary{},
				ServerRunning: false,
			}, nil
		}
		return wshrpc.TmuxListSessionsResponse{
			Sessions:      []wshrpc.TmuxSessionSummary{},
			ServerRunning: true,
			Error:         makeTmuxError(err, stdout, stderr),
		}, nil
	}
	sessions, parseErr := parseTmuxSessionSummaries(stdout)
	if parseErr != nil {
		return wshrpc.TmuxListSessionsResponse{
			Sessions:      []wshrpc.TmuxSessionSummary{},
			ServerRunning: true,
			Error: &wshrpc.TmuxError{
				Code:    "unknown",
				Message: "Unable to parse tmux session list.",
				Detail:  parseErr.Error(),
			},
		}, nil
	}
	return wshrpc.TmuxListSessionsResponse{
		Sessions:      sessions,
		ServerRunning: true,
	}, nil
}

func (ws *WshServer) TmuxListWindowsCommand(ctx context.Context, data wshrpc.TmuxListWindowsRequest) (wshrpc.TmuxListWindowsResponse, error) {
	if strings.TrimSpace(data.Session) == "" {
		return wshrpc.TmuxListWindowsResponse{
			Windows: []wshrpc.TmuxWindowSummary{},
			Error: &wshrpc.TmuxError{
				Code:    "invalid_request",
				Message: "Session is required when listing tmux windows.",
			},
		}, nil
	}
	stdout, stderr, err := runTmuxCLI(ctx, data.Connection, tmuxListWindowsArgs(data.Session))
	if err != nil {
		return wshrpc.TmuxListWindowsResponse{
			Windows: []wshrpc.TmuxWindowSummary{},
			Error:   makeTmuxError(err, stdout, stderr),
		}, nil
	}
	windows, parseErr := parseTmuxWindowSummaries(stdout)
	if parseErr != nil {
		return wshrpc.TmuxListWindowsResponse{
			Windows: []wshrpc.TmuxWindowSummary{},
			Error: &wshrpc.TmuxError{
				Code:    "unknown",
				Message: "Unable to parse tmux window list.",
				Detail:  parseErr.Error(),
			},
		}, nil
	}
	return wshrpc.TmuxListWindowsResponse{Windows: windows}, nil
}

func tmuxListSessionsArgs() []string {
	return []string{
		"list-sessions",
		"-F",
		fmt.Sprintf("#{session_name}%s#{session_windows}%s#{session_attached}", tmuxFieldSep, tmuxFieldSep),
	}
}

func tmuxListWindowsArgs(session string) []string {
	return []string{
		"list-windows",
		"-t",
		session,
		"-F",
		fmt.Sprintf("#{window_index}%s#{window_name}%s#{?window_active,1,0}", tmuxFieldSep, tmuxFieldSep),
	}
}

func runTmuxCLI(ctx context.Context, connName string, args []string) (string, string, error) {
	if conncontroller.IsLocalConnName(connName) {
		return runLocalTmuxCLI(ctx, args)
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
		return runShellTmuxCLI(ctx, genconn.MakeWSLShellClient(client), args)
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
	return runShellTmuxCLI(ctx, genconn.MakeSSHShellClient(client), args)
}

func runLocalTmuxCLI(ctx context.Context, args []string) (string, string, error) {
	cmd := exec.CommandContext(ctx, "tmux", args...)
	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	err := cmd.Run()
	return stdoutBuf.String(), stderrBuf.String(), err
}

func runShellTmuxCLI(ctx context.Context, client genconn.ShellClient, args []string) (string, string, error) {
	stdout, stderr, err := genconn.RunSimpleCommand(ctx, client, genconn.CommandSpec{
		Cmd: buildTmuxShellCommand(args),
	})
	return stdout, stderr, err
}

func buildTmuxShellCommand(args []string) string {
	var b strings.Builder
	b.WriteString("tmux")
	for _, arg := range args {
		b.WriteByte(' ')
		b.WriteString(shellutil.HardQuote(arg))
	}
	return b.String()
}

func parseTmuxSessionSummaries(output string) ([]wshrpc.TmuxSessionSummary, error) {
	lines := splitNonEmptyLines(output)
	sessions := make([]wshrpc.TmuxSessionSummary, 0, len(lines))
	for _, line := range lines {
		parts := strings.SplitN(line, tmuxFieldSep, 3)
		if len(parts) != 3 {
			return nil, fmt.Errorf("unexpected tmux session row: %q", line)
		}
		windows, err := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err != nil {
			return nil, fmt.Errorf("invalid window count in row %q: %w", line, err)
		}
		attached, err := strconv.Atoi(strings.TrimSpace(parts[2]))
		if err != nil {
			return nil, fmt.Errorf("invalid attached count in row %q: %w", line, err)
		}
		sessions = append(sessions, wshrpc.TmuxSessionSummary{
			Name:     strings.TrimSpace(parts[0]),
			Windows:  windows,
			Attached: attached,
		})
	}
	return sessions, nil
}

func parseTmuxWindowSummaries(output string) ([]wshrpc.TmuxWindowSummary, error) {
	lines := splitNonEmptyLines(output)
	windows := make([]wshrpc.TmuxWindowSummary, 0, len(lines))
	for _, line := range lines {
		parts := strings.SplitN(line, tmuxFieldSep, 3)
		if len(parts) != 3 {
			return nil, fmt.Errorf("unexpected tmux window row: %q", line)
		}
		index, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			return nil, fmt.Errorf("invalid window index in row %q: %w", line, err)
		}
		activeRaw := strings.TrimSpace(parts[2])
		active := activeRaw == "1" || strings.EqualFold(activeRaw, "true")
		windows = append(windows, wshrpc.TmuxWindowSummary{
			Index:  index,
			Name:   strings.TrimSpace(parts[1]),
			Active: active,
		})
	}
	return windows, nil
}

func isNoTmuxServerError(err error, stdout string, stderr string) bool {
	if err == nil {
		return false
	}
	detail := strings.TrimSpace(stderr)
	if detail == "" {
		detail = strings.TrimSpace(stdout)
	}
	if detail == "" {
		detail = err.Error()
	}
	lowerDetail := strings.ToLower(detail)
	return strings.Contains(lowerDetail, "no server running on")
}

func makeTmuxError(err error, stdout string, stderr string) *wshrpc.TmuxError {
	detail := strings.TrimSpace(stderr)
	if detail == "" {
		detail = strings.TrimSpace(stdout)
	}
	if detail == "" && err != nil {
		detail = err.Error()
	}
	lowerDetail := strings.ToLower(detail)
	switch {
	case errors.Is(err, exec.ErrNotFound),
		strings.Contains(lowerDetail, "executable file not found"),
		strings.Contains(lowerDetail, "tmux: command not found"),
		strings.Contains(lowerDetail, "'tmux' is not recognized"):
		return &wshrpc.TmuxError{
			Code:    "missing_cli",
			Message: "tmux CLI is not available on this connection.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "no server running on"):
		return &wshrpc.TmuxError{
			Code:    "no_server",
			Message: "No tmux server is running on this connection.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "can't find session"),
		strings.Contains(lowerDetail, "no such session"):
		return &wshrpc.TmuxError{
			Code:    "session_not_found",
			Message: "The target tmux session was not found.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "permission denied"):
		return &wshrpc.TmuxError{
			Code:    "permission_denied",
			Message: "Permission denied while accessing tmux on this connection.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "connection"),
		(strings.Contains(lowerDetail, "not found") || strings.Contains(lowerDetail, "unavailable")):
		return &wshrpc.TmuxError{
			Code:    "connection_unavailable",
			Message: "The target connection is unavailable.",
			Detail:  detail,
		}
	default:
		return &wshrpc.TmuxError{
			Code:    "unknown",
			Message: "tmux command failed.",
			Detail:  detail,
		}
	}
}
