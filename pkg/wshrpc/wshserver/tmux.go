// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const tmuxFieldSep = "\t"

var tmuxNameInvalidChars = ":.$*?!"

func validateTmuxName(name, label string) *wshrpc.TmuxError {
	if strings.ContainsAny(name, tmuxNameInvalidChars) {
		return &wshrpc.TmuxError{
			Code:    "invalid_request",
			Message: fmt.Sprintf("%s contains invalid characters (%s).", label, tmuxNameInvalidChars),
			Detail:  fmt.Sprintf("The characters %q are reserved in tmux target specifications.", tmuxNameInvalidChars),
		}
	}
	return nil
}

// TmuxGetConfigCommand reads tmux options (prefix, prefix2) for the given connection.
// Reserved for future tmux prefix display and command-prompt features in the UI.
func (ws *WshServer) TmuxGetConfigCommand(ctx context.Context, data wshrpc.TmuxGetConfigRequest) (wshrpc.TmuxGetConfigResponse, error) {
	prefix, errResp := readTmuxOption(ctx, data.Connection, "prefix")
	if errResp != nil {
		return wshrpc.TmuxGetConfigResponse{Error: errResp}, nil
	}
	prefix2, errResp := readTmuxOption(ctx, data.Connection, "prefix2")
	if errResp != nil {
		return wshrpc.TmuxGetConfigResponse{Error: errResp}, nil
	}
	return wshrpc.TmuxGetConfigResponse{
		Prefix:  prefix,
		Prefix2: prefix2,
	}, nil
}

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
		if isNoTmuxServerError(err, stdout, stderr) {
			return wshrpc.TmuxListWindowsResponse{
				Windows: []wshrpc.TmuxWindowSummary{},
				Error: &wshrpc.TmuxError{
					Code:    "no_server",
					Message: "No tmux server is running on this connection.",
				},
			}, nil
		}
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

func (ws *WshServer) TmuxActionCommand(ctx context.Context, data wshrpc.TmuxActionRequest) (wshrpc.TmuxActionResponse, error) {
	args, reqErr := buildTmuxActionArgs(data)
	if reqErr != nil {
		return wshrpc.TmuxActionResponse{Error: reqErr}, nil
	}
	stdout, stderr, err := runTmuxCLI(ctx, data.Connection, args)
	if err != nil {
		return wshrpc.TmuxActionResponse{Error: makeTmuxError(err, stdout, stderr)}, nil
	}
	return wshrpc.TmuxActionResponse{}, nil
}

func buildTmuxActionArgs(data wshrpc.TmuxActionRequest) ([]string, *wshrpc.TmuxError) {
	switch data.Action {
	case "create_session":
		sessionName := strings.TrimSpace(data.Session)
		if sessionName == "" {
			return nil, invalidTmuxRequest("Session is required when creating a tmux session.")
		}
		if err := validateTmuxName(sessionName, "Session name"); err != nil {
			return nil, err
		}
		return []string{"new-session", "-A", "-d", "-s", sessionName}, nil
	case "create_window":
		sessionName := strings.TrimSpace(data.Session)
		if sessionName == "" {
			return nil, invalidTmuxRequest("Session is required when creating a tmux window.")
		}
		windowName := strings.TrimSpace(data.WindowName)
		if windowName == "" {
			return []string{"new-window", "-t", sessionName}, nil
		}
		if err := validateTmuxName(windowName, "Window name"); err != nil {
			return nil, err
		}
		return []string{"new-window", "-t", sessionName, "-n", windowName}, nil
	case "rename_session":
		sessionName := strings.TrimSpace(data.Session)
		newName := strings.TrimSpace(data.NewName)
		if sessionName == "" || newName == "" {
			return nil, invalidTmuxRequest("Session and newName are required when renaming a tmux session.")
		}
		if err := validateTmuxName(newName, "New session name"); err != nil {
			return nil, err
		}
		return []string{"rename-session", "-t", sessionName, newName}, nil
	case "rename_window":
		sessionName := strings.TrimSpace(data.Session)
		newName := strings.TrimSpace(data.NewName)
		if sessionName == "" || newName == "" {
			return nil, invalidTmuxRequest("Session and newName are required when renaming a tmux window.")
		}
		if data.WindowIndex == nil {
			return nil, invalidTmuxRequest("WindowIndex is required when renaming a tmux window.")
		}
		if err := validateTmuxName(newName, "New window name"); err != nil {
			return nil, err
		}
		return []string{"rename-window", "-t", tmuxWindowTarget(sessionName, *data.WindowIndex), newName}, nil
	case "detach_session":
		sessionName := strings.TrimSpace(data.Session)
		if sessionName == "" {
			return nil, invalidTmuxRequest("Session is required when detaching a tmux session.")
		}
		return []string{"detach-client", "-s", sessionName}, nil
	case "kill_session":
		sessionName := strings.TrimSpace(data.Session)
		if sessionName == "" {
			return nil, invalidTmuxRequest("Session is required when killing a tmux session.")
		}
		return []string{"kill-session", "-t", sessionName}, nil
	case "kill_window":
		sessionName := strings.TrimSpace(data.Session)
		if sessionName == "" {
			return nil, invalidTmuxRequest("Session is required when killing a tmux window.")
		}
		if data.WindowIndex == nil {
			return nil, invalidTmuxRequest("WindowIndex is required when killing a tmux window.")
		}
		return []string{"kill-window", "-t", tmuxWindowTarget(sessionName, *data.WindowIndex)}, nil
	default:
		return nil, invalidTmuxRequest(fmt.Sprintf("Unsupported tmux action %q.", data.Action))
	}
}

func tmuxListSessionsArgs() []string {
	return []string{
		"list-sessions",
		"-F",
		fmt.Sprintf("#{session_name}%s#{session_windows}%s#{session_attached}", tmuxFieldSep, tmuxFieldSep),
	}
}

func tmuxShowOptionArgs(option string) []string {
	return []string{"show-options", "-gqv", option}
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
	return runCLI(ctx, connName, "tmux", args)
}

func readTmuxOption(ctx context.Context, connName string, option string) (string, *wshrpc.TmuxError) {
	stdout, stderr, err := runTmuxCLI(ctx, connName, tmuxShowOptionArgs(option))
	if err != nil {
		return "", makeTmuxError(err, stdout, stderr)
	}
	return strings.TrimSpace(stdout), nil
}

// tmuxWindowTarget builds a tmux window target string (session:windowIndex).
// Callers (rename_window, kill_window) have already validated via validateTmuxName
// that the session name does not contain ':' or other reserved characters,
// so the colon delimiter here is unambiguous.
func tmuxWindowTarget(session string, windowIndex int) string {
	return fmt.Sprintf("%s:%d", session, windowIndex)
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
	case strings.Contains(lowerDetail, "connection refused"),
		strings.Contains(lowerDetail, "connection reset"),
		strings.Contains(lowerDetail, "no such connection"),
		strings.Contains(lowerDetail, "connection not found"),
		strings.Contains(lowerDetail, "connection unavailable"),
		strings.Contains(lowerDetail, "ssh:") && strings.Contains(lowerDetail, "not found"),
		strings.Contains(lowerDetail, "ssh:") && strings.Contains(lowerDetail, "unavailable"):
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

func invalidTmuxRequest(message string) *wshrpc.TmuxError {
	return &wshrpc.TmuxError{
		Code:    "invalid_request",
		Message: message,
	}
}
