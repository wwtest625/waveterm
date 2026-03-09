// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/authkey"
	"github.com/wavetermdev/waveterm/pkg/service"
)

const (
	mcpProtocolVersion = "2024-11-05"
	mcpServerName      = "wave-mcp"
	mcpServerVersion   = "0.1.0"

	defaultWaitTimeoutMS = 15000
	defaultWaitPollMS    = 250
	minWaitTimeoutMS     = 100
	maxWaitTimeoutMS     = 300000
	minWaitPollMS        = 50
	maxWaitPollMS        = 10000
	maxCommandResultBytes = 2 * 1024 * 1024
	maxCommandResultLines = 10000
)

var (
	mcpServeEndpoint string
	mcpServeAuthKey  string
	mcpServeTabId    string
	mcpServeBlockId  string
	mcpServeAgentMode string
)

var mcpServeCmd = &cobra.Command{
	Use:    "mcpserve",
	Short:  "run Wave MCP stdio server",
	Hidden: true,
	RunE:   mcpServeRun,
}

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

func init() {
	mcpServeCmd.Flags().StringVar(&mcpServeEndpoint, "endpoint", "", "Wave web endpoint, e.g. http://127.0.0.1:PORT")
	mcpServeCmd.Flags().StringVar(&mcpServeAuthKey, "authkey", "", "Wave auth key")
	mcpServeCmd.Flags().StringVar(&mcpServeTabId, "tabid", "", "default tab id")
	mcpServeCmd.Flags().StringVar(&mcpServeBlockId, "blockid", "", "default terminal block id")
	mcpServeCmd.Flags().StringVar(&mcpServeAgentMode, "agentmode", "", "terminal agent mode override (default, planning, auto-approve)")
	rootCmd.AddCommand(mcpServeCmd)
}

func mcpServeRun(cmd *cobra.Command, args []string) (rtnErr error) {
	defer func() {
		sendActivity("mcpserve", rtnErr == nil)
	}()

	endpoint := strings.TrimRight(strings.TrimSpace(mcpServeEndpoint), "/")
	if endpoint == "" {
		endpoint = strings.TrimRight(strings.TrimSpace(osGetenv("WAVETERM_WEB_ENDPOINT")), "/")
	}
	if endpoint == "" {
		return fmt.Errorf("--endpoint is required")
	}

	authKeyVal := strings.TrimSpace(mcpServeAuthKey)
	if authKeyVal == "" {
		authKeyVal = strings.TrimSpace(osGetenv(authkey.WaveAuthKeyEnv))
	}
	if authKeyVal == "" {
		return fmt.Errorf("--authkey is required")
	}

	tabId := strings.TrimSpace(mcpServeTabId)
	if tabId == "" {
		tabId = strings.TrimSpace(osGetenv("WAVETERM_TABID"))
	}
	if tabId == "" {
		return fmt.Errorf("--tabid is required")
	}

	defaultBlockId := strings.TrimSpace(mcpServeBlockId)
	agentMode := normalizeMCPAgentMode(strings.TrimSpace(mcpServeAgentMode))
	if agentMode == "" {
		agentMode = normalizeMCPAgentMode(strings.TrimSpace(osGetenv("WAVETERM_AGENTMODE")))
	}
	state := &mcpServerState{
		endpoint:       endpoint,
		authKey:        authKeyVal,
		defaultTabId:   tabId,
		defaultBlockId: defaultBlockId,
		agentMode:      agentMode,
		httpClient:     &http.Client{},
	}

	reader := bufio.NewReader(WrappedStdin)
	writer := bufio.NewWriter(WrappedStdout)
	for {
		msg, err := readMCPMessage(reader)
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read mcp message: %w", err)
		}

		rawID, hasID := msg["id"]
		method, _ := msg["method"].(string)
		params, _ := msg["params"].(map[string]any)

		result, rpcErr, shouldExit := state.handleRPC(method, params)
		if shouldExit {
			return nil
		}
		if !hasID {
			continue
		}

		resp := map[string]any{
			"jsonrpc": "2.0",
			"id":      rawID,
		}
		if rpcErr != nil {
			resp["error"] = map[string]any{
				"code":    rpcErr.Code,
				"message": rpcErr.Message,
			}
		} else {
			resp["result"] = result
		}
		if err := writeMCPMessage(writer, resp); err != nil {
			return fmt.Errorf("write mcp response: %w", err)
		}
	}
}

type mcpServerState struct {
	endpoint       string
	authKey        string
	defaultTabId   string
	defaultBlockId string
	agentMode      string
	httpClient     *http.Client
}

func normalizeMCPAgentMode(raw string) string {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "planning":
		return "planning"
	case "auto-approve":
		return "auto-approve"
	default:
		return "default"
	}
}

type mcpRPCError struct {
	Code    int
	Message string
}

func (s *mcpServerState) handleRPC(method string, params map[string]any) (any, *mcpRPCError, bool) {
	switch method {
	case "initialize":
		return map[string]any{
			"protocolVersion": mcpProtocolVersion,
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    mcpServerName,
				"version": mcpServerVersion,
			},
		}, nil, false
	case "notifications/initialized":
		return nil, nil, false
	case "ping":
		return map[string]any{}, nil, false
	case "shutdown":
		return map[string]any{}, nil, false
	case "exit":
		return nil, nil, true
	case "tools/list":
		return map[string]any{"tools": getMCPTools()}, nil, false
	case "tools/call":
		result, err := s.handleToolCall(params)
		if err != nil {
			return nil, &mcpRPCError{Code: -32000, Message: err.Error()}, false
		}
		return result, nil, false
	default:
		return nil, &mcpRPCError{Code: -32601, Message: fmt.Sprintf("method not found: %s", method)}, false
	}
}

func getMCPTools() []mcpTool {
	return []mcpTool{
		{
			Name:        "wave_read_current_terminal_context",
			Description: "Read current terminal context in Wave (tab/block/connection/cwd/status). Use this before deciding what terminal command to run.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"tab_id": map[string]any{
						"type":        "string",
						"description": "Optional tab id override.",
					},
					"block_id": map[string]any{
						"type":        "string",
						"description": "Optional terminal block id override.",
					},
				},
			},
		},
		{
			Name:        "wave_read_terminal_scrollback",
			Description: "Read scrollback tail text from current terminal.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"tab_id": map[string]any{
						"type":        "string",
						"description": "Optional tab id override.",
					},
					"block_id": map[string]any{
						"type":        "string",
						"description": "Optional terminal block id override.",
					},
					"max_bytes": map[string]any{
						"type":        "number",
						"description": "Tail byte budget (default 65536, max 2097152).",
					},
					"max_lines": map[string]any{
						"type":        "number",
						"description": "Max returned lines (default 200).",
					},
				},
			},
		},
		{
			Name:        "wave_inject_terminal_command",
			Description: "Inject a command into current terminal controller (auto appends newline). After this, wait for completion and then read the command result tool.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"tab_id": map[string]any{
						"type":        "string",
						"description": "Optional tab id override.",
					},
					"block_id": map[string]any{
						"type":        "string",
						"description": "Optional terminal block id override.",
					},
					"command": map[string]any{
						"type":        "string",
						"description": "Command text to inject.",
					},
					"force": map[string]any{
						"type":        "boolean",
						"description": "Bypass recent user activity protection.",
					},
				},
				"required": []string{"command"},
			},
		},
		{
			Name:        "wave_get_terminal_command_status",
			Description: "Get current command execution status for current terminal.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"tab_id": map[string]any{
						"type":        "string",
						"description": "Optional tab id override.",
					},
					"block_id": map[string]any{
						"type":        "string",
						"description": "Optional terminal block id override.",
					},
				},
			},
		},
		{
			Name:        "wave_get_terminal_command_result",
			Description: "Read incremental output for the current terminal command since a start offset. Use this after wave_wait_terminal_idle to inspect the result of the command you just ran.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"tab_id": map[string]any{
						"type":        "string",
						"description": "Optional tab id override.",
					},
					"block_id": map[string]any{
						"type":        "string",
						"description": "Optional terminal block id override.",
					},
					"command": map[string]any{
						"type":        "string",
						"description": "Optional command label for the returned result.",
					},
					"start_offset": map[string]any{
						"type":        "number",
						"description": "Logical terminal byte offset to start reading from.",
					},
					"max_bytes": map[string]any{
						"type":        "number",
						"description": "Maximum bytes to read from the incremental output window.",
					},
					"max_lines": map[string]any{
						"type":        "number",
						"description": "Maximum returned lines after sanitizing output.",
					},
				},
			},
		},
		{
			Name:        "wave_wait_terminal_idle",
			Description: "Poll terminal command status until command is no longer running or timeout. Use this after command injection before reading the command result.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"tab_id": map[string]any{
						"type":        "string",
						"description": "Optional tab id override.",
					},
					"block_id": map[string]any{
						"type":        "string",
						"description": "Optional terminal block id override.",
					},
					"timeout_ms": map[string]any{
						"type":        "number",
						"description": "Wait timeout in milliseconds (default 15000, min 100, max 300000).",
					},
					"poll_ms": map[string]any{
						"type":        "number",
						"description": "Polling interval in milliseconds (default 250, min 50, max 10000).",
					},
				},
			},
		},
	}
}

func (s *mcpServerState) handleToolCall(params map[string]any) (map[string]any, error) {
	name, _ := params["name"].(string)
	args, _ := params["arguments"].(map[string]any)
	if args == nil {
		args = map[string]any{}
	}

	switch name {
	case "wave_read_current_terminal_context":
		tabId, blockId, err := parseTerminalTargetArgs(args, s.defaultTabId, s.defaultBlockId)
		if err != nil {
			return toolError(err), nil
		}
		data, err := s.callWaveService("block", "GetTerminalContext", []any{tabId, blockId})
		if err != nil {
			return toolError(err), nil
		}
		return toolText(data), nil
	case "wave_read_terminal_scrollback":
		tabId, blockId, err := parseTerminalTargetArgs(args, s.defaultTabId, s.defaultBlockId)
		if err != nil {
			return toolError(err), nil
		}
		req := map[string]any{
			"tabid":   tabId,
			"blockid": blockId,
		}
		if v, ok := numberArg(args, "max_bytes"); ok {
			req["maxbytes"] = int(v)
		}
		if v, ok := numberArg(args, "max_lines"); ok {
			req["maxlines"] = int(v)
		}
		data, err := s.callWaveService("block", "GetTerminalScrollback", []any{req})
		if err != nil {
			return toolError(err), nil
		}
		return toolText(data), nil
	case "wave_inject_terminal_command":
		if s.agentMode == "planning" {
			return toolError(fmt.Errorf("wave_inject_terminal_command is not allowed in planning mode")), nil
		}
		tabId, blockId, err := parseTerminalTargetArgs(args, s.defaultTabId, s.defaultBlockId)
		if err != nil {
			return toolError(err), nil
		}
		command := stringArg(args, "command", "")
		force, err := strictBoolArg(args, "force", false)
		if err != nil {
			return toolError(err), nil
		}
		req := map[string]any{
			"tabid":   tabId,
			"blockid": blockId,
			"command": command,
			"force":   force,
		}
		data, err := s.callWaveService("block", "InjectTerminalCommand", []any{req})
		if err != nil {
			return toolError(err), nil
		}
		return toolText(data), nil
	case "wave_get_terminal_command_status":
		tabId, blockId, err := parseTerminalTargetArgs(args, s.defaultTabId, s.defaultBlockId)
		if err != nil {
			return toolError(err), nil
		}
		data, err := s.callWaveService("block", "GetTerminalCommandStatus", []any{tabId, blockId})
		if err != nil {
			return toolError(err), nil
		}
		return toolText(data), nil
	case "wave_get_terminal_command_result":
		tabId, blockId, err := parseTerminalTargetArgs(args, s.defaultTabId, s.defaultBlockId)
		if err != nil {
			return toolError(err), nil
		}
		startOffset, err := strictIntArg(args, "start_offset", 0, 0, 0)
		if err != nil {
			return toolError(err), nil
		}
		maxBytes, err := strictIntArg(args, "max_bytes", 0, 0, maxCommandResultBytes)
		if err != nil {
			return toolError(err), nil
		}
		maxLines, err := strictIntArg(args, "max_lines", 0, 0, maxCommandResultLines)
		if err != nil {
			return toolError(err), nil
		}
		req := map[string]any{
			"tabid":       tabId,
			"blockid":     blockId,
			"command":     stringArg(args, "command", ""),
			"startoffset": startOffset,
		}
		if maxBytes > 0 {
			req["maxbytes"] = maxBytes
		}
		if maxLines > 0 {
			req["maxlines"] = maxLines
		}
		data, err := s.callWaveService("block", "GetTerminalCommandResult", []any{req})
		if err != nil {
			return toolError(err), nil
		}
		return toolText(data), nil
	case "wave_wait_terminal_idle":
		tabId, blockId, err := parseTerminalTargetArgs(args, s.defaultTabId, s.defaultBlockId)
		if err != nil {
			return toolError(err), nil
		}
		timeoutMS, err := strictIntArg(args, "timeout_ms", defaultWaitTimeoutMS, minWaitTimeoutMS, maxWaitTimeoutMS)
		if err != nil {
			return toolError(err), nil
		}
		pollMS, err := strictIntArg(args, "poll_ms", defaultWaitPollMS, minWaitPollMS, maxWaitPollMS)
		if err != nil {
			return toolError(err), nil
		}
		if pollMS > timeoutMS {
			return toolError(fmt.Errorf("poll_ms must be <= timeout_ms")), nil
		}
		startTs := time.Now()
		deadline := startTs.Add(time.Duration(timeoutMS) * time.Millisecond)
		attempts := 0
		var lastData any
		for {
			attempts++
			data, err := s.callWaveService("block", "GetTerminalCommandStatus", []any{tabId, blockId})
			if err != nil {
				return toolError(err), nil
			}
			lastData = data
			status, err := parseTerminalCommandStatus(data)
			if err != nil {
				return toolError(err), nil
			}
			if status != "running" {
				return toolText(map[string]any{
					"waited_ms":       int(time.Since(startTs).Milliseconds()),
					"attempts":        attempts,
					"terminal_status": data,
				}), nil
			}
			if !time.Now().Before(deadline) {
				break
			}
			sleepDur := time.Duration(pollMS) * time.Millisecond
			remaining := time.Until(deadline)
			if remaining < sleepDur {
				sleepDur = remaining
			}
			if sleepDur > 0 {
				time.Sleep(sleepDur)
			}
		}
		return toolError(fmt.Errorf("timeout waiting for terminal idle after %dms (last status: %v)", timeoutMS, lastData)), nil
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}

func parseTerminalTargetArgs(args map[string]any, defaultTabId string, defaultBlockId string) (string, string, error) {
	tabID, err := strictStringArg(args, "tab_id", defaultTabId, true)
	if err != nil {
		return "", "", err
	}
	blockID, err := strictStringArg(args, "block_id", defaultBlockId, false)
	if err != nil {
		return "", "", err
	}
	return tabID, blockID, nil
}

func strictStringArg(args map[string]any, key string, def string, required bool) (string, error) {
	if args != nil {
		if raw, ok := args[key]; ok && raw != nil {
			s, ok := raw.(string)
			if !ok {
				if required {
					return "", fmt.Errorf("%s is required", key)
				}
				return "", fmt.Errorf("%s must be a non-empty string", key)
			}
			trimmed := strings.TrimSpace(s)
			if trimmed == "" {
				if required {
					return "", fmt.Errorf("%s is required", key)
				}
				return "", fmt.Errorf("%s must be a non-empty string", key)
			}
			return trimmed, nil
		}
	}
	trimmedDefault := strings.TrimSpace(def)
	if trimmedDefault != "" {
		return trimmedDefault, nil
	}
	if required {
		return "", fmt.Errorf("%s is required", key)
	}
	return "", nil
}

func strictIntArg(args map[string]any, key string, def int, minValue int, maxValue int) (int, error) {
	val := def
	if args != nil {
		if raw, ok := args[key]; ok && raw != nil {
			switch n := raw.(type) {
			case float64:
				if math.IsNaN(n) || math.IsInf(n, 0) || math.Trunc(n) != n {
					return 0, fmt.Errorf("%s must be an integer number", key)
				}
				val = int(n)
			case int:
				val = n
			case int64:
				val = int(n)
			default:
				return 0, fmt.Errorf("%s must be an integer number", key)
			}
		}
	}
	if val < minValue {
		return 0, fmt.Errorf("%s must be >= %d", key, minValue)
	}
	if maxValue > 0 && val > maxValue {
		return 0, fmt.Errorf("%s must be <= %d", key, maxValue)
	}
	return val, nil
}

func strictBoolArg(args map[string]any, key string, def bool) (bool, error) {
	if args != nil {
		if raw, ok := args[key]; ok && raw != nil {
			b, ok := raw.(bool)
			if !ok {
				return false, fmt.Errorf("%s must be a boolean", key)
			}
			return b, nil
		}
	}
	return def, nil
}

func parseTerminalCommandStatus(data any) (string, error) {
	statusMap, ok := data.(map[string]any)
	if !ok {
		return "", fmt.Errorf("invalid terminal status response")
	}
	statusRaw, ok := statusMap["status"]
	if !ok || statusRaw == nil {
		return "", fmt.Errorf("terminal status response missing status")
	}
	status, ok := statusRaw.(string)
	if !ok || strings.TrimSpace(status) == "" {
		return "", fmt.Errorf("terminal status response missing status")
	}
	return strings.TrimSpace(status), nil
}

func (s *mcpServerState) callWaveService(serviceName string, method string, args []any) (any, error) {
	body := service.WebCallType{
		Service: serviceName,
		Method:  method,
		Args:    args,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	url := s.endpoint + "/wave/service"
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(authkey.AuthKeyHeader, s.authKey)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	rawResp, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var rtn service.WebReturnType
	if err := json.Unmarshal(rawResp, &rtn); err != nil {
		return nil, fmt.Errorf("decode service response: %w", err)
	}
	if rtn.Error != "" {
		return nil, errors.New(rtn.Error)
	}
	return rtn.Data, nil
}

func readMCPMessage(reader *bufio.Reader) (map[string]any, error) {
	contentLength := -1
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF && strings.TrimSpace(line) == "" && contentLength < 0 {
				return nil, io.EOF
			}
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if contentLength < 0 {
				// tolerate stray blank lines between messages
				continue
			}
			break
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(strings.ToLower(parts[0]))
		val := strings.TrimSpace(parts[1])
		if key == "content-length" {
			cl, err := strconv.Atoi(val)
			if err != nil {
				return nil, fmt.Errorf("invalid content-length: %w", err)
			}
			contentLength = cl
		}
	}
	if contentLength < 0 {
		return nil, fmt.Errorf("missing content-length")
	}
	payload := make([]byte, contentLength)
	if _, err := io.ReadFull(reader, payload); err != nil {
		return nil, err
	}
	var msg map[string]any
	if err := json.Unmarshal(payload, &msg); err != nil {
		return nil, fmt.Errorf("invalid json payload: %w", err)
	}
	return msg, nil
}

func writeMCPMessage(writer *bufio.Writer, payload any) error {
	barr, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(writer, "Content-Length: %d\r\n\r\n", len(barr)); err != nil {
		return err
	}
	if _, err := writer.Write(barr); err != nil {
		return err
	}
	return writer.Flush()
}

func toolText(data any) map[string]any {
	textBytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		textBytes = []byte(fmt.Sprintf("%v", data))
	}
	return map[string]any{
		"content": []map[string]any{
			{
				"type": "text",
				"text": string(textBytes),
			},
		},
		"isError": false,
	}
}

func toolError(err error) map[string]any {
	return map[string]any{
		"content": []map[string]any{
			{
				"type": "text",
				"text": err.Error(),
			},
		},
		"isError": true,
	}
}

func stringArg(args map[string]any, key string, def string) string {
	if args == nil {
		return def
	}
	v, ok := args[key]
	if !ok || v == nil {
		return def
	}
	if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	return def
}

func numberArg(args map[string]any, key string) (float64, bool) {
	if args == nil {
		return 0, false
	}
	v, ok := args[key]
	if !ok || v == nil {
		return 0, false
	}
	n, ok := v.(float64)
	return n, ok
}

func osGetenv(name string) string {
	return os.Getenv(name)
}
