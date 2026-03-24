// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

type agentContextToken struct {
	BlockId string `json:"blockid"`
}

type agentBlockDetails struct {
	BlockId     string              `json:"blockid"`
	WorkspaceId string              `json:"workspaceid"`
	TabId       string              `json:"tabid"`
	View        string              `json:"view"`
	Connection  string              `json:"connection,omitempty"`
	Cwd         string              `json:"cwd,omitempty"`
	Meta        waveobj.MetaMapType `json:"meta"`
}

var (
	agentTermAnsiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
	agentCmd = &cobra.Command{
		Use:   "agent",
		Short: "Agent-friendly Wave commands",
	}
	agentBlocksCmd = &cobra.Command{
		Use:   "blocks",
		Short: "Agent block discovery commands",
	}
	agentBlocksListCmd = &cobra.Command{
		Use:                   "list",
		Short:                 "List blocks as JSON for agents",
		PreRunE:               preRunSetupAgentRpcClient,
		RunE:                  agentBlocksListRun,
		SilenceUsage:          true,
		DisableFlagsInUseLine: true,
	}
	agentResolveContextCmd = &cobra.Command{
		Use:                   "resolve-context",
		Short:                 "Resolve an agent context token for a block",
		PreRunE:               preRunSetupAgentRpcClient,
		RunE:                  agentResolveContextRun,
		SilenceUsage:          true,
		DisableFlagsInUseLine: true,
	}
	agentGetMetaCmd = &cobra.Command{
		Use:                   "getmeta",
		Short:                 "Get block metadata using an agent context token",
		PreRunE:               preRunSetupAgentRpcClient,
		RunE:                  agentGetMetaRun,
		SilenceUsage:          true,
		DisableFlagsInUseLine: true,
	}
	agentTermScrollbackCmd = &cobra.Command{
		Use:                   "termscrollback",
		Short:                 "Get terminal scrollback using an agent context token",
		PreRunE:               preRunSetupAgentRpcClient,
		RunE:                  agentTermScrollbackRun,
		SilenceUsage:          true,
		DisableFlagsInUseLine: true,
	}
	agentRunCommandCmd = &cobra.Command{
		Use:                   "run-command -- COMMAND [args...]",
		Short:                 "Run a command using an agent context token",
		PreRunE:               preRunSetupAgentRpcClient,
		RunE:                  agentRunCommandRun,
		SilenceUsage:          true,
		DisableFlagsInUseLine: true,
	}
	agentContextTokenFlag string
)

func init() {
	agentBlocksCmd.AddCommand(agentBlocksListCmd)
	agentCmd.AddCommand(agentBlocksCmd)
	agentCmd.AddCommand(agentResolveContextCmd)
	agentCmd.AddCommand(agentGetMetaCmd)
	agentCmd.AddCommand(agentTermScrollbackCmd)
	agentCmd.AddCommand(agentRunCommandCmd)
	rootCmd.AddCommand(agentCmd)

	agentResolveContextCmd.Flags().StringVarP(&blockArg, "block", "b", "", "target block id")
	agentGetMetaCmd.Flags().StringVar(&agentContextTokenFlag, "context-token", "", "agent context token")
	agentTermScrollbackCmd.Flags().StringVar(&agentContextTokenFlag, "context-token", "", "agent context token")
	agentRunCommandCmd.Flags().StringVar(&agentContextTokenFlag, "context-token", "", "agent context token")
	agentTermScrollbackCmd.Flags().IntVar(&termScrollbackLineStart, "start", 0, "starting line number")
	agentTermScrollbackCmd.Flags().IntVar(&termScrollbackLineEnd, "end", 0, "ending line number")
	agentTermScrollbackCmd.Flags().BoolVar(&termScrollbackLastCmd, "lastcommand", false, "get output of last command")
}

func encodeAgentContextToken(token agentContextToken) (string, error) {
	data, err := json.Marshal(token)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func decodeAgentContextToken(raw string) (*agentContextToken, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("context token is required")
	}
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("decode context token: %w", err)
	}
	var token agentContextToken
	if err := json.Unmarshal(data, &token); err != nil {
		return nil, fmt.Errorf("parse context token: %w", err)
	}
	if strings.TrimSpace(token.BlockId) == "" {
		return nil, fmt.Errorf("context token missing blockid")
	}
	return &token, nil
}

func agentResolveBlockORef(tokenStr string) (*waveobj.ORef, error) {
	token, err := decodeAgentContextToken(tokenStr)
	if err != nil {
		return nil, err
	}
	return &waveobj.ORef{OType: waveobj.OType_Block, OID: token.BlockId}, nil
}

func agentResolveBlockORefFromFlags(tokenStr string) (*waveobj.ORef, error) {
	if strings.TrimSpace(tokenStr) != "" {
		return agentResolveBlockORef(tokenStr)
	}
	if strings.TrimSpace(blockArg) != "" {
		if _, err := uuid.Parse(strings.TrimSpace(blockArg)); err == nil {
			return &waveobj.ORef{OType: waveobj.OType_Block, OID: strings.TrimSpace(blockArg)}, nil
		}
	}
	fullORef, err := resolveBlockArg()
	if err != nil {
		return nil, fmt.Errorf("resolve block: %w", err)
	}
	if fullORef.OType != waveobj.OType_Block {
		return nil, fmt.Errorf("resolved object is not a block: %s", fullORef)
	}
	return fullORef, nil
}

func agentNormalizeTermLines(text string) []string {
	text = agentTermAnsiRe.ReplaceAllString(text, "")
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	if text == "" {
		return []string{}
	}
	lines := strings.Split(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func agentTermScrollbackFallback(fullORef *waveobj.ORef) (*wshrpc.CommandTermGetScrollbackLinesRtnData, error) {
	if termScrollbackLastCmd {
		return nil, fmt.Errorf("lastcommand is not available without a frontend block route")
	}
	debugData, err := wshclient.DebugTermCommand(RpcClient, wshrpc.CommandDebugTermData{
		BlockId: fullORef.OID,
		Size:    256 * 1024,
	}, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return nil, err
	}
	rawData, err := base64.StdEncoding.DecodeString(debugData.Data64)
	if err != nil {
		return nil, fmt.Errorf("decode debug term data: %w", err)
	}
	lines := agentNormalizeTermLines(string(rawData))
	lineStart := termScrollbackLineStart
	if lineStart < 0 {
		lineStart = 0
	}
	lineEnd := termScrollbackLineEnd
	if lineEnd <= 0 || lineEnd > len(lines) {
		lineEnd = len(lines)
	}
	if lineStart > lineEnd {
		lineStart = lineEnd
	}
	return &wshrpc.CommandTermGetScrollbackLinesRtnData{
		TotalLines: len(lines),
		LineStart:  lineStart,
		Lines:      lines[lineStart:lineEnd],
	}, nil
}

func agentBlocksListRun(cmd *cobra.Command, args []string) error {
	workspaces, err := wshclient.WorkspaceListCommand(RpcClient, &wshrpc.RpcOpts{Timeout: 5000})
	if err != nil {
		return fmt.Errorf("list workspaces: %w", err)
	}
	var allBlocks []agentBlockDetails
	appendBlocks := func(blocks []wshrpc.BlocksListEntry) {
		for _, b := range blocks {
			allBlocks = append(allBlocks, agentBlockDetails{
				BlockId:     b.BlockId,
				WorkspaceId: b.WorkspaceId,
				TabId:       b.TabId,
				View:        b.Meta.GetString(waveobj.MetaKey_View, ""),
				Connection:  b.Meta.GetString(waveobj.MetaKey_Connection, ""),
				Cwd:         b.Meta.GetString(waveobj.MetaKey_CmdCwd, ""),
				Meta:        b.Meta,
			})
		}
	}
	if len(workspaces) == 0 {
		blocks, err := wshclient.BlocksListCommand(RpcClient, wshrpc.BlocksListRequest{}, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			return fmt.Errorf("list blocks: %w", err)
		}
		appendBlocks(blocks)
	}
	for _, ws := range workspaces {
		blocks, err := wshclient.BlocksListCommand(RpcClient, wshrpc.BlocksListRequest{WorkspaceId: ws.WorkspaceData.OID}, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			continue
		}
		appendBlocks(blocks)
	}
	sort.SliceStable(allBlocks, func(i, j int) bool {
		if allBlocks[i].WorkspaceId != allBlocks[j].WorkspaceId {
			return allBlocks[i].WorkspaceId < allBlocks[j].WorkspaceId
		}
		if allBlocks[i].TabId != allBlocks[j].TabId {
			return allBlocks[i].TabId < allBlocks[j].TabId
		}
		return allBlocks[i].BlockId < allBlocks[j].BlockId
	})
	data, err := json.MarshalIndent(allBlocks, "", "  ")
	if err != nil {
		return err
	}
	WriteStdout("%s\n", string(data))
	return nil
}

func agentResolveContextRun(cmd *cobra.Command, args []string) error {
	fullORef, err := agentResolveBlockORefFromFlags("")
	if err != nil {
		return err
	}
	token, err := encodeAgentContextToken(agentContextToken{BlockId: fullORef.OID})
	if err != nil {
		return err
	}
	WriteStdout("%s\n", token)
	return nil
}

func agentGetMetaRun(cmd *cobra.Command, args []string) error {
	fullORef, err := agentResolveBlockORefFromFlags(agentContextTokenFlag)
	if err != nil {
		return err
	}
	resp, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *fullORef}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("getting metadata: %w", err)
	}
	data, err := json.MarshalIndent(resp, "", "  ")
	if err != nil {
		return err
	}
	WriteStdout("%s\n", string(data))
	return nil
}

func agentTermScrollbackRun(cmd *cobra.Command, args []string) error {
	fullORef, err := agentResolveBlockORefFromFlags(agentContextTokenFlag)
	if err != nil {
		return err
	}
	metaData, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *fullORef}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("error getting block metadata: %w", err)
	}
	viewType, ok := metaData[waveobj.MetaKey_View].(string)
	if !ok || viewType != "term" {
		return fmt.Errorf("block %s is not a terminal block (view type: %s)", fullORef.OID, viewType)
	}
	if termScrollbackLastCmd {
		result, err := wshclient.AgentTermScrollbackCommand(RpcClient, wshrpc.CommandAgentTermScrollbackData{
			BlockId:     fullORef.OID,
			LineStart:   termScrollbackLineStart,
			LineEnd:     termScrollbackLineEnd,
			LastCommand: true,
		}, &wshrpc.RpcOpts{Timeout: 5000})
		if err != nil {
			return fmt.Errorf("error getting terminal scrollback: %w", err)
		}
		data, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			return err
		}
		WriteStdout("%s\n", string(data))
		return nil
	}
	result, err := wshclient.TermGetScrollbackLinesCommand(RpcClient, wshrpc.CommandTermGetScrollbackLinesData{
		LineStart:   termScrollbackLineStart,
		LineEnd:     termScrollbackLineEnd,
		LastCommand: termScrollbackLastCmd,
	}, &wshrpc.RpcOpts{
		Route:   wshutil.MakeFeBlockRouteId(fullORef.OID),
		Timeout: 5000,
	})
	if err != nil {
		if strings.Contains(err.Error(), "no route for") {
			result, err = agentTermScrollbackFallback(fullORef)
		}
		if err != nil {
			return fmt.Errorf("error getting terminal scrollback: %w", err)
		}
	}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	WriteStdout("%s\n", string(data))
	return nil
}

func agentRunCommandRun(cmd *cobra.Command, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("command is required")
	}
	fullORef, err := agentResolveBlockORefFromFlags(agentContextTokenFlag)
	if err != nil {
		return err
	}
	metaData, err := wshclient.GetMetaCommand(RpcClient, wshrpc.CommandGetMetaData{ORef: *fullORef}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return fmt.Errorf("error getting block metadata: %w", err)
	}
	connection, _ := metaData[waveobj.MetaKey_Connection].(string)
	if strings.TrimSpace(connection) == "" {
		connection = RpcContext.Conn
	}
	cwd, _ := metaData[waveobj.MetaKey_CmdCwd].(string)
	runResp, err := wshclient.AgentRunCommandCommand(RpcClient, wshrpc.CommandAgentRunCommandData{
		ConnName: connection,
		Cwd:      cwd,
		Cmd:      args[0],
		Args:     args[1:],
	}, &wshrpc.RpcOpts{Timeout: 10000})
	if err != nil {
		return fmt.Errorf("run command: %w", err)
	}
	result, err := wshclient.AgentGetCommandResultCommand(RpcClient, wshrpc.CommandAgentGetCommandResultData{
		JobId:     runResp.JobId,
		TailBytes: 32768,
	}, &wshrpc.RpcOpts{Timeout: 35000})
	if err != nil {
		return fmt.Errorf("get command result: %w", err)
	}
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	WriteStdout("%s\n", string(data))
	return nil
}
