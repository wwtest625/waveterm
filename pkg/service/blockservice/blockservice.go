// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

type BlockService struct{}

const DefaultTimeout = 2 * time.Second

var BlockServiceInstance = &BlockService{}

const (
	defaultTerminalTailBytes = 64 * 1024
	defaultTerminalTailLines = 200
	maxTerminalTailBytes     = 2 * 1024 * 1024
)

// Matches common ANSI CSI/OSC/control escape sequences.
var ansiEscapePattern = regexp.MustCompile(`\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\a]*(?:\a|\x1b\\))`)

type TerminalContextData struct {
	TabId              string `json:"tabid"`
	BlockId            string `json:"blockid"`
	View               string `json:"view"`
	Connection         string `json:"connection,omitempty"`
	Cwd                string `json:"cwd,omitempty"`
	ControllerStatus   string `json:"controllerstatus,omitempty"`
	ControllerConnName string `json:"controllerconnname,omitempty"`
	ControllerExitCode int    `json:"controllerexitcode,omitempty"`
}

type TerminalScrollbackRequest struct {
	TabId    string `json:"tabid"`
	BlockId  string `json:"blockid,omitempty"`
	MaxBytes int    `json:"maxbytes,omitempty"`
	MaxLines int    `json:"maxlines,omitempty"`
}

type TerminalScrollbackData struct {
	TabId     string   `json:"tabid"`
	BlockId   string   `json:"blockid"`
	BytesRead int      `json:"bytesread"`
	Text      string   `json:"text"`
	Lines     []string `json:"lines"`
	Truncated bool     `json:"truncated"`
}

type TerminalInjectRequest struct {
	TabId   string `json:"tabid"`
	BlockId string `json:"blockid,omitempty"`
	Command string `json:"command"`
	Force   bool   `json:"force,omitempty"`
}

type TerminalInjectData struct {
	TabId   string `json:"tabid"`
	BlockId string `json:"blockid"`
	Sent    bool   `json:"sent"`
}

type TerminalCommandStatusData struct {
	TabId        string `json:"tabid"`
	BlockId      string `json:"blockid"`
	Status       string `json:"status"`
	LastCommand  string `json:"lastcommand,omitempty"`
	ExitCode     *int   `json:"exitcode,omitempty"`
	LastOutputTs int64  `json:"lastoutputts,omitempty"`
}

type TerminalCommandResultData struct {
	TabId          string   `json:"tabid"`
	BlockId        string   `json:"blockid"`
	Command        string   `json:"command,omitempty"`
	Status         string   `json:"status"`
	ExitCode       *int     `json:"exitcode,omitempty"`
	CaptureStatus  string   `json:"capturestatus"`
	StartOffset    int64    `json:"startoffset"`
	ReadOffset     int64    `json:"readoffset"`
	EndOffset      int64    `json:"endoffset"`
	BytesRead      int      `json:"bytesread"`
	Text           string   `json:"text"`
	Lines          []string `json:"lines"`
	Truncated      bool     `json:"truncated"`
	BlockedReason  string   `json:"blockedreason,omitempty"`
	OutputTooLarge bool     `json:"outputtoolarge,omitempty"`
}

type TerminalCommandResultRequest struct {
	TabId       string `json:"tabid"`
	BlockId     string `json:"blockid,omitempty"`
	Command     string `json:"command,omitempty"`
	StartOffset int64  `json:"startoffset,omitempty"`
	MaxBytes    int    `json:"maxbytes,omitempty"`
	MaxLines    int    `json:"maxlines,omitempty"`
}

type TerminalUserActivityStateData struct {
	TabId          string `json:"tabid"`
	BlockId        string `json:"blockid"`
	IsUserActive   bool   `json:"isuseractive"`
	LastActivityTs int64  `json:"lastactivityts,omitempty"`
}

const terminalUserActivityWindow = 5 * time.Second

func (bs *BlockService) SendCommand_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "send command to block",
		ArgNames: []string{"blockid", "cmd"},
	}
}

func (bs *BlockService) GetControllerStatus(ctx context.Context, blockId string) (*blockcontroller.BlockControllerRuntimeStatus, error) {
	return blockcontroller.GetBlockControllerRuntimeStatus(blockId), nil
}

func (*BlockService) GetTerminalContext_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "resolve current terminal context for a tab",
		ArgNames: []string{"ctx", "tabId", "blockId"},
	}
}

func (bs *BlockService) GetTerminalContext(ctx context.Context, tabId string, blockId string) (*TerminalContextData, error) {
	if tabId == "" {
		return nil, fmt.Errorf("tabId is required")
	}
	termBlock, err := resolveTerminalBlockForTab(ctx, tabId, blockId)
	if err != nil {
		return nil, err
	}
	status := blockcontroller.GetBlockControllerRuntimeStatus(termBlock.OID)
	rtn := &TerminalContextData{
		TabId:      tabId,
		BlockId:    termBlock.OID,
		View:       termBlock.Meta.GetString(waveobj.MetaKey_View, ""),
		Connection: termBlock.Meta.GetString(waveobj.MetaKey_Connection, ""),
		Cwd:        termBlock.Meta.GetString(waveobj.MetaKey_CmdCwd, ""),
	}
	if status != nil {
		rtn.ControllerStatus = status.ShellProcStatus
		rtn.ControllerConnName = status.ShellProcConnName
		rtn.ControllerExitCode = status.ShellProcExitCode
	}
	return rtn, nil
}

func (*BlockService) GetTerminalCommandStatus_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "resolve current terminal command status for a tab",
		ArgNames: []string{"ctx", "tabId", "blockId"},
	}
}

func (bs *BlockService) GetTerminalCommandStatus(ctx context.Context, tabId string, blockId string) (*TerminalCommandStatusData, error) {
	if tabId == "" {
		return nil, fmt.Errorf("tabId is required")
	}
	termBlock, err := resolveTerminalBlockForTab(ctx, tabId, blockId)
	if err != nil {
		return nil, err
	}
	controllerStatus := blockcontroller.GetBlockControllerRuntimeStatus(termBlock.OID)
	rtInfo := wstore.GetRTInfo(waveobj.MakeORef(waveobj.OType_Block, termBlock.OID))
	return buildTerminalCommandStatusData(tabId, termBlock.OID, controllerStatus, rtInfo), nil
}

func (*BlockService) GetTerminalScrollback_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "read tail scrollback text from a tab terminal",
		ArgNames: []string{"ctx", "req"},
	}
}

func (bs *BlockService) GetTerminalScrollback(ctx context.Context, req TerminalScrollbackRequest) (*TerminalScrollbackData, error) {
	if req.TabId == "" {
		return nil, fmt.Errorf("tabId is required")
	}
	termBlock, err := resolveTerminalBlockForTab(ctx, req.TabId, req.BlockId)
	if err != nil {
		return nil, err
	}

	maxBytes := req.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultTerminalTailBytes
	}
	if maxBytes > maxTerminalTailBytes {
		maxBytes = maxTerminalTailBytes
	}
	maxLines := req.MaxLines
	if maxLines <= 0 {
		maxLines = defaultTerminalTailLines
	}

	rawTail, truncated, err := readTerminalTail(ctx, termBlock.OID, maxBytes)
	if err != nil {
		return nil, err
	}
	text := normalizeTermText(stripAnsi(string(rawTail)))
	lines := splitLines(text)
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
		truncated = true
	}
	return &TerminalScrollbackData{
		TabId:     req.TabId,
		BlockId:   termBlock.OID,
		BytesRead: len(rawTail),
		Text:      strings.Join(lines, "\n"),
		Lines:     lines,
		Truncated: truncated,
	}, nil
}

func (*BlockService) GetTerminalCommandResult_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "read incremental terminal command output from a start offset",
		ArgNames: []string{"ctx", "req"},
	}
}

func (bs *BlockService) GetTerminalCommandResult(ctx context.Context, req TerminalCommandResultRequest) (*TerminalCommandResultData, error) {
	if req.TabId == "" {
		return nil, fmt.Errorf("tabId is required")
	}
	termBlock, err := resolveTerminalBlockForTab(ctx, req.TabId, req.BlockId)
	if err != nil {
		return nil, err
	}
	maxBytes := req.MaxBytes
	if maxBytes <= 0 {
		maxBytes = defaultTerminalTailBytes
	}
	if maxBytes > maxTerminalTailBytes {
		maxBytes = maxTerminalTailBytes
	}
	maxLines := req.MaxLines
	if maxLines <= 0 {
		maxLines = defaultTerminalTailLines
	}
	readOffset, endOffset, rawOutput, truncated, err := readTerminalWindow(ctx, termBlock.OID, req.StartOffset, maxBytes)
	if err != nil {
		return nil, err
	}
	controllerStatus := blockcontroller.GetBlockControllerRuntimeStatus(termBlock.OID)
	rtInfo := wstore.GetRTInfo(waveobj.MakeORef(waveobj.OType_Block, termBlock.OID))
	commandStatus := buildTerminalCommandStatusData(req.TabId, termBlock.OID, controllerStatus, rtInfo)
	command := strings.TrimSpace(req.Command)
	if command == "" && commandStatus != nil {
		command = commandStatus.LastCommand
	}
	status := "unknown"
	var exitCode *int
	if commandStatus != nil {
		status = commandStatus.Status
		exitCode = commandStatus.ExitCode
	}
	return buildTerminalCommandResultData(
		req.TabId,
		termBlock.OID,
		command,
		status,
		exitCode,
		req.StartOffset,
		readOffset,
		endOffset,
		rawOutput,
		truncated,
		maxLines,
	), nil
}

func (*BlockService) InjectTerminalCommand_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "inject a command to the resolved terminal controller",
		ArgNames: []string{"ctx", "req"},
	}
}

func (bs *BlockService) InjectTerminalCommand(ctx context.Context, req TerminalInjectRequest) (*TerminalInjectData, error) {
	if req.TabId == "" {
		return nil, fmt.Errorf("tabId is required")
	}
	command := strings.TrimSpace(req.Command)
	if command == "" {
		return nil, fmt.Errorf("command is required")
	}
	termBlock, err := resolveTerminalBlockForTab(ctx, req.TabId, req.BlockId)
	if err != nil {
		return nil, err
	}
	rtInfo := wstore.GetRTInfo(waveobj.MakeORef(waveobj.OType_Block, termBlock.OID))
	if err := validateTerminalInjectAllowed(rtInfo, req.Force, time.Now()); err != nil {
		return nil, err
	}
	if !strings.HasSuffix(command, "\n") {
		command += "\n"
	}
	err = blockcontroller.SendInput(termBlock.OID, &blockcontroller.BlockInputUnion{
		InputData: []byte(command),
	})
	if err != nil {
		return nil, fmt.Errorf("sending command to terminal %s: %w", termBlock.OID, err)
	}
	return &TerminalInjectData{
		TabId:   req.TabId,
		BlockId: termBlock.OID,
		Sent:    true,
	}, nil
}

func (*BlockService) GetUserActivityState_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "resolve recent terminal user activity state for a tab",
		ArgNames: []string{"ctx", "tabId", "blockId"},
	}
}

func (bs *BlockService) GetUserActivityState(ctx context.Context, tabId string, blockId string) (*TerminalUserActivityStateData, error) {
	if tabId == "" {
		return nil, fmt.Errorf("tabId is required")
	}
	termBlock, err := resolveTerminalBlockForTab(ctx, tabId, blockId)
	if err != nil {
		return nil, err
	}
	rtInfo := wstore.GetRTInfo(waveobj.MakeORef(waveobj.OType_Block, termBlock.OID))
	return buildTerminalUserActivityState(tabId, termBlock.OID, rtInfo, time.Now()), nil
}

func (*BlockService) SaveTerminalState_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "save the terminal state to a blockfile",
		ArgNames: []string{"ctx", "blockId", "state", "stateType", "ptyOffset", "termSize"},
	}
}

func (bs *BlockService) SaveTerminalState(ctx context.Context, blockId string, state string, stateType string, ptyOffset int64, termSize waveobj.TermSize) error {
	_, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	if stateType != "full" && stateType != "preview" {
		return fmt.Errorf("invalid state type: %q", stateType)
	}
	// ignore MakeFile error (already exists is ok)
	filestore.WFS.MakeFile(ctx, blockId, "cache:term:"+stateType, nil, wshrpc.FileOpts{})
	err = filestore.WFS.WriteFile(ctx, blockId, "cache:term:"+stateType, []byte(state))
	if err != nil {
		return fmt.Errorf("cannot save terminal state: %w", err)
	}
	fileMeta := wshrpc.FileMeta{
		"ptyoffset": ptyOffset,
		"termsize":  termSize,
	}
	err = filestore.WFS.WriteMeta(ctx, blockId, "cache:term:"+stateType, fileMeta, true)
	if err != nil {
		return fmt.Errorf("cannot save terminal state meta: %w", err)
	}
	return nil
}

func (bs *BlockService) SaveWaveAiData(ctx context.Context, blockId string, history []wshrpc.WaveAIPromptMessageType) error {
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return err
	}
	viewName := block.Meta.GetString(waveobj.MetaKey_View, "")
	if viewName != "waveai" {
		return fmt.Errorf("invalid view type: %s", viewName)
	}
	historyBytes, err := json.Marshal(history)
	if err != nil {
		return fmt.Errorf("unable to serialize ai history: %v", err)
	}
	// ignore MakeFile error (already exists is ok)
	filestore.WFS.MakeFile(ctx, blockId, "aidata", nil, wshrpc.FileOpts{})
	err = filestore.WFS.WriteFile(ctx, blockId, "aidata", historyBytes)
	if err != nil {
		return fmt.Errorf("cannot save terminal state: %w", err)
	}
	return nil
}

func (*BlockService) CleanupOrphanedBlocks_Meta() tsgenmeta.MethodMeta {
	return tsgenmeta.MethodMeta{
		Desc:     "queue a layout action to cleanup orphaned blocks in the tab",
		ArgNames: []string{"ctx", "tabId"},
	}
}

func (bs *BlockService) CleanupOrphanedBlocks(ctx context.Context, tabId string) (waveobj.UpdatesRtnType, error) {
	ctx = waveobj.ContextWithUpdates(ctx)
	layoutAction := waveobj.LayoutActionData{
		ActionType: wcore.LayoutActionDataType_CleanupOrphaned,
		ActionId:   uuid.NewString(),
	}
	err := wcore.QueueLayoutActionForTab(ctx, tabId, layoutAction)
	if err != nil {
		return nil, fmt.Errorf("error queuing cleanup layout action: %w", err)
	}
	return waveobj.ContextGetUpdatesRtn(ctx), nil
}

func resolveTerminalBlockForTab(ctx context.Context, tabId string, preferredBlockId string) (*waveobj.Block, error) {
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil {
		return nil, fmt.Errorf("loading tab %s: %w", tabId, err)
	}
	if len(tab.BlockIds) == 0 {
		return nil, fmt.Errorf("tab %s has no blocks", tabId)
	}

	// 1) caller-specified block (if terminal)
	if preferredBlockId != "" {
		if block, err := terminalBlockById(ctx, tab, preferredBlockId); err == nil {
			return block, nil
		}
	}

	// 2) focused layout node block (if terminal)
	focusedBlockId, _ := resolveFocusedBlockId(ctx, tab)
	if focusedBlockId != "" {
		if block, err := terminalBlockById(ctx, tab, focusedBlockId); err == nil {
			return block, nil
		}
	}

	// 3) first terminal block in tab order
	for _, blockId := range tab.BlockIds {
		if block, err := terminalBlockById(ctx, tab, blockId); err == nil {
			return block, nil
		}
	}
	return nil, fmt.Errorf("no terminal block found in tab %s", tabId)
}

func resolveFocusedBlockId(ctx context.Context, tab *waveobj.Tab) (string, error) {
	if tab == nil || tab.LayoutState == "" {
		return "", nil
	}
	layoutState, err := wstore.DBGet[*waveobj.LayoutState](ctx, tab.LayoutState)
	if err != nil || layoutState == nil || layoutState.FocusedNodeId == "" || layoutState.LeafOrder == nil {
		return "", err
	}
	for _, entry := range *layoutState.LeafOrder {
		if entry.NodeId == layoutState.FocusedNodeId {
			return entry.BlockId, nil
		}
	}
	return "", nil
}

func terminalBlockById(ctx context.Context, tab *waveobj.Tab, blockId string) (*waveobj.Block, error) {
	if blockId == "" {
		return nil, fmt.Errorf("blockId is empty")
	}
	found := false
	for _, id := range tab.BlockIds {
		if id == blockId {
			found = true
			break
		}
	}
	if !found {
		return nil, fmt.Errorf("block %s not found in tab %s", blockId, tab.OID)
	}
	block, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, err
	}
	if block.Meta.GetString(waveobj.MetaKey_View, "") != "term" {
		return nil, fmt.Errorf("block %s is not terminal", blockId)
	}
	return block, nil
}

func readTerminalTail(ctx context.Context, blockId string, maxBytes int) ([]byte, bool, error) {
	waveFile, err := filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term)
	if err == fs.ErrNotExist {
		return []byte{}, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("stating term file: %w", err)
	}
	dataLength := waveFile.DataLength()
	readSize := int64(maxBytes)
	truncated := false
	if readSize > dataLength {
		readSize = dataLength
	} else if readSize < dataLength {
		truncated = true
	}
	if readSize <= 0 {
		return []byte{}, false, nil
	}
	readOffset := waveFile.Size - readSize
	_, readData, err := filestore.WFS.ReadAt(ctx, blockId, wavebase.BlockFile_Term, readOffset, readSize)
	if err != nil {
		return nil, false, fmt.Errorf("reading term tail: %w", err)
	}
	return readData, truncated, nil
}

func readTerminalWindow(ctx context.Context, blockId string, startOffset int64, maxBytes int) (int64, int64, []byte, bool, error) {
	waveFile, err := filestore.WFS.Stat(ctx, blockId, wavebase.BlockFile_Term)
	if err == fs.ErrNotExist {
		return startOffset, startOffset, []byte{}, false, nil
	}
	if err != nil {
		return 0, 0, nil, false, fmt.Errorf("stating term file: %w", err)
	}
	dataStart := waveFile.DataStartIdx()
	endOffset := waveFile.Size
	readOffset := startOffset
	truncated := false
	if readOffset < dataStart {
		readOffset = dataStart
		truncated = true
	}
	if readOffset > endOffset {
		readOffset = endOffset
	}
	readSize := endOffset - readOffset
	if readSize <= 0 {
		return readOffset, endOffset, []byte{}, truncated, nil
	}
	if maxBytes > 0 && readSize > int64(maxBytes) {
		readOffset = endOffset - int64(maxBytes)
		readSize = int64(maxBytes)
		truncated = true
	}
	actualOffset, readData, err := filestore.WFS.ReadAt(ctx, blockId, wavebase.BlockFile_Term, readOffset, readSize)
	if err != nil {
		return 0, 0, nil, false, fmt.Errorf("reading term window: %w", err)
	}
	if actualOffset > readOffset {
		truncated = true
		readOffset = actualOffset
	}
	return readOffset, endOffset, readData, truncated, nil
}

func stripAnsi(text string) string {
	return ansiEscapePattern.ReplaceAllString(text, "")
}

func normalizeTermText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	return text
}

func splitLines(text string) []string {
	if text == "" {
		return []string{}
	}
	lines := strings.Split(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func buildTerminalCommandResultData(tabId string, blockId string, command string, status string, exitCode *int, startOffset int64, readOffset int64, endOffset int64, rawOutput []byte, truncated bool, maxLines int) *TerminalCommandResultData {
	text := normalizeTermText(stripAnsi(string(rawOutput)))
	lines := splitLines(text)
	if maxLines <= 0 {
		maxLines = defaultTerminalTailLines
	}
	outputTooLarge := false
	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
		truncated = true
		outputTooLarge = true
	}
	text = strings.Join(lines, "\n")
	captureStatus := "ready"
	if len(lines) == 0 {
		captureStatus = "empty"
	}
	if outputTooLarge {
		captureStatus = "too_large"
	}
	return &TerminalCommandResultData{
		TabId:          tabId,
		BlockId:        blockId,
		Command:        command,
		Status:         status,
		ExitCode:       exitCode,
		CaptureStatus:  captureStatus,
		StartOffset:    startOffset,
		ReadOffset:     readOffset,
		EndOffset:      endOffset,
		BytesRead:      len(rawOutput),
		Text:           text,
		Lines:          lines,
		Truncated:      truncated,
		OutputTooLarge: outputTooLarge,
	}
}

func buildTerminalCommandStatusData(tabId string, blockId string, controllerStatus *blockcontroller.BlockControllerRuntimeStatus, rtInfo *waveobj.ObjRTInfo) *TerminalCommandStatusData {
	rtn := &TerminalCommandStatusData{
		TabId:   tabId,
		BlockId: blockId,
		Status:  "idle",
	}
	if controllerStatus == nil || controllerStatus.ShellProcStatus != blockcontroller.Status_Running {
		rtn.Status = "unavailable"
		return rtn
	}
	if rtInfo == nil || !rtInfo.ShellIntegration {
		return rtn
	}
	if rtInfo.ShellLastCmd != "" {
		rtn.LastCommand = rtInfo.ShellLastCmd
	}
	switch rtInfo.ShellState {
	case "running-command":
		rtn.Status = "running"
	case "ready":
		if rtn.LastCommand != "" {
			rtn.Status = "completed"
			exitCode := rtInfo.ShellLastCmdExitCode
			rtn.ExitCode = &exitCode
		}
	default:
		if rtn.LastCommand != "" {
			rtn.Status = "unknown"
		}
	}
	return rtn
}

func buildTerminalUserActivityState(tabId string, blockId string, rtInfo *waveobj.ObjRTInfo, now time.Time) *TerminalUserActivityStateData {
	rtn := &TerminalUserActivityStateData{
		TabId:   tabId,
		BlockId: blockId,
	}
	if rtInfo == nil || rtInfo.TermLastUserInputTs <= 0 {
		return rtn
	}
	rtn.LastActivityTs = rtInfo.TermLastUserInputTs
	lastActivity := time.UnixMilli(rtInfo.TermLastUserInputTs)
	rtn.IsUserActive = now.Sub(lastActivity) < terminalUserActivityWindow
	return rtn
}

func validateTerminalInjectAllowed(rtInfo *waveobj.ObjRTInfo, force bool, now time.Time) error {
	if force {
		return nil
	}
	state := buildTerminalUserActivityState("", "", rtInfo, now)
	if state.IsUserActive {
		return fmt.Errorf("user is currently typing in terminal")
	}
	return nil
}
