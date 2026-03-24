// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"fmt"
	"github.com/spf13/cobra"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
)

var (
	rootCmd = &cobra.Command{
		Use:          "wsh",
		Short:        "CLI tool to control Wave Terminal",
		Long:         `wsh is a small utility that lets you do cool things with Wave Terminal, right from the command line`,
		SilenceUsage: true,
	}
)

var WrappedStdin io.Reader = os.Stdin
var WrappedStdout io.Writer = &WrappedWriter{dest: os.Stdout}
var WrappedStderr io.Writer = &WrappedWriter{dest: os.Stderr}
var RpcClient *wshutil.WshRpc
var RpcContext wshrpc.RpcContext
var UsingTermWshMode bool
var blockArg string
var WshExitCode int

type WrappedWriter struct {
	dest io.Writer
}

func (w *WrappedWriter) Write(p []byte) (n int, err error) {
	if !UsingTermWshMode {
		return w.dest.Write(p)
	}
	count := 0
	for _, b := range p {
		if b == '\n' {
			count++
		}
	}
	if count == 0 {
		return w.dest.Write(p)
	}
	buf := make([]byte, len(p)+count) // Each '\n' adds one extra byte for '\r'
	writeIdx := 0
	for _, b := range p {
		if b == '\n' {
			buf[writeIdx] = '\r'
			buf[writeIdx+1] = '\n'
			writeIdx += 2
		} else {
			buf[writeIdx] = b
			writeIdx++
		}
	}
	return w.dest.Write(buf)
}

func WriteStderr(fmtStr string, args ...interface{}) {
	WrappedStderr.Write([]byte(fmt.Sprintf(fmtStr, args...)))
}

func WriteStdout(fmtStr string, args ...interface{}) {
	WrappedStdout.Write([]byte(fmt.Sprintf(fmtStr, args...)))
}

func OutputHelpMessage(cmd *cobra.Command) {
	cmd.SetOutput(WrappedStderr)
	cmd.Help()
	WriteStderr("\n")
}

func preRunSetupRpcClient(cmd *cobra.Command, args []string) error {
	jwtToken := os.Getenv(wshutil.WaveJwtTokenVarName)
	if jwtToken == "" {
		return fmt.Errorf("wsh must be run inside a Wave-managed SSH session (WAVETERM_JWT not found)")
	}
	err := setupRpcClient(nil, jwtToken)
	if err != nil {
		return err
	}
	return nil
}

func preRunSetupAgentRpcClient(cmd *cobra.Command, args []string) error {
	var errs []string
	for _, sockName := range resolveAgentSocketCandidates() {
		var err error
		RpcClient, err = wshutil.SetupDomainSocketRpcClient(sockName, nil, "wsh-agent")
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", sockName, err))
			continue
		}
		authRtn, err := wshclient.AgentAuthenticateCommand(RpcClient, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", sockName, err))
			RpcClient = nil
			continue
		}
		if authRtn.RpcContext != nil {
			RpcContext = *authRtn.RpcContext
		} else {
			RpcContext = wshrpc.RpcContext{RouteId: authRtn.RouteId}
		}
		RpcContext.SockName = sockName
		return nil
	}
	return fmt.Errorf("error setting up agent rpc client: %s", strings.Join(errs, "; "))
}

func resolveAgentSocketName() string {
	candidates := resolveAgentSocketCandidates()
	if len(candidates) > 0 {
		return candidates[0]
	}
	return ""
}

func resolveAgentWaveDataHome() string {
	if dataHome := strings.TrimSpace(wavebase.GetWaveDataDir()); dataHome != "" {
		return dataHome
	}
	if dataHome := strings.TrimSpace(os.Getenv(wavebase.WaveDataHomeEnvVar)); dataHome != "" {
		return dataHome
	}
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		if strings.EqualFold(filepath.Base(exeDir), wavebase.AppPathBinDir) {
			parent := filepath.Dir(exeDir)
			if strings.EqualFold(filepath.Base(parent), "Data") {
				return parent
			}
		}
	}
	if runtime.GOOS == "windows" {
		if localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); localAppData != "" {
			return filepath.Join(localAppData, "waveterm", "Data")
		}
		return ""
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(homeDir, wavebase.RemoteWaveHomeDirName)
}

func resolveAgentSocketCandidates() []string {
	var candidates []string
	add := func(sockName string) {
		sockName = strings.TrimSpace(sockName)
		if sockName == "" {
			return
		}
		sockName = wavebase.ExpandHomeDirSafe(sockName)
		if !filepath.IsAbs(sockName) {
			return
		}
		for _, existing := range candidates {
			if strings.EqualFold(existing, sockName) {
				return
			}
		}
		candidates = append(candidates, sockName)
	}
	if dataHome := resolveAgentWaveDataHome(); dataHome != "" {
		add(filepath.Join(dataHome, wavebase.DomainSocketBaseName))
	}
	if runtime.GOOS == "windows" {
		if localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); localAppData != "" {
			add(filepath.Join(localAppData, "waveterm-dev", "Data", wavebase.DomainSocketBaseName))
			add(filepath.Join(localAppData, "waveterm", "Data", wavebase.DomainSocketBaseName))
		}
	}
	return candidates
}

func getIsTty() bool {
	if fileInfo, _ := os.Stdout.Stat(); (fileInfo.Mode() & os.ModeCharDevice) != 0 {
		return true
	}
	return false
}

type RunEFnType = func(*cobra.Command, []string) error

func activityWrap(activityStr string, origRunE RunEFnType) RunEFnType {
	return func(cmd *cobra.Command, args []string) (rtnErr error) {
		defer func() {
			sendActivity(activityStr, rtnErr == nil)
		}()
		return origRunE(cmd, args)
	}
}

func resolveBlockArg() (*waveobj.ORef, error) {
	oref := blockArg
	if oref == "" {
		oref = "this"
	}
	fullORef, err := resolveSimpleId(oref)
	if err != nil {
		return nil, fmt.Errorf("resolving blockid: %w", err)
	}
	return fullORef, nil
}

func setupRpcClientWithToken(swapTokenStr string) (wshrpc.CommandAuthenticateRtnData, error) {
	var rtn wshrpc.CommandAuthenticateRtnData
	token, err := shellutil.UnpackSwapToken(swapTokenStr)
	if err != nil {
		return rtn, fmt.Errorf("error unpacking token: %w", err)
	}
	if token.RpcContext == nil {
		return rtn, fmt.Errorf("no rpccontext in token")
	}
	if token.RpcContext.SockName == "" {
		return rtn, fmt.Errorf("no sockname in token")
	}
	RpcContext = *token.RpcContext
	RpcClient, err = wshutil.SetupDomainSocketRpcClient(token.RpcContext.SockName, nil, "wshcmd")
	if err != nil {
		return rtn, fmt.Errorf("error setting up domain socket rpc client: %w", err)
	}
	return wshclient.AuthenticateTokenCommand(RpcClient, wshrpc.CommandAuthenticateTokenData{Token: token.Token}, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
}

// returns the wrapped stdin and a new rpc client (that wraps the stdin input and stdout output)
func setupRpcClient(serverImpl wshutil.ServerImpl, jwtToken string) error {
	rpcCtx, err := wshutil.ExtractUnverifiedRpcContext(jwtToken)
	if err != nil {
		return fmt.Errorf("error extracting rpc context from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	RpcContext = *rpcCtx
	sockName, err := wshutil.ExtractUnverifiedSocketName(jwtToken)
	if err != nil {
		return fmt.Errorf("error extracting socket name from %s: %v", wshutil.WaveJwtTokenVarName, err)
	}
	RpcClient, err = wshutil.SetupDomainSocketRpcClient(sockName, serverImpl, "wshcmd")
	if err != nil {
		return fmt.Errorf("error setting up domain socket rpc client: %v", err)
	}
	_, err = wshclient.AuthenticateCommand(RpcClient, jwtToken, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	if err != nil {
		return fmt.Errorf("error authenticating: %v", err)
	}
	blockId := os.Getenv("WAVETERM_BLOCKID")
	if blockId != "" {
		peerInfo := fmt.Sprintf("domain:block:%s", blockId)
		wshclient.SetPeerInfoCommand(RpcClient, peerInfo, &wshrpc.RpcOpts{Route: wshutil.ControlRoute})
	}
	// note we don't modify WrappedStdin here (just use os.Stdin)
	return nil
}

func isFullORef(orefStr string) bool {
	_, err := waveobj.ParseORef(orefStr)
	return err == nil
}

func resolveSimpleId(id string) (*waveobj.ORef, error) {
	if isFullORef(id) {
		orefObj, err := waveobj.ParseORef(id)
		if err != nil {
			return nil, fmt.Errorf("error parsing full ORef: %v", err)
		}
		return &orefObj, nil
	}
	blockId := os.Getenv("WAVETERM_BLOCKID")
	if blockId == "" {
		return nil, fmt.Errorf("no WAVETERM_BLOCKID env var set")
	}
	rtnData, err := wshclient.ResolveIdsCommand(RpcClient, wshrpc.CommandResolveIdsData{
		BlockId: blockId,
		Ids:     []string{id},
	}, &wshrpc.RpcOpts{Timeout: 2000})
	if err != nil {
		return nil, fmt.Errorf("error resolving ids: %v", err)
	}
	oref, ok := rtnData.ResolvedIds[id]
	if !ok {
		return nil, fmt.Errorf("id not found: %q", id)
	}
	return &oref, nil
}

func getTabIdFromEnv() string {
	return os.Getenv("WAVETERM_TABID")
}

// this will send wsh activity to the client running on *your* local machine (it does not contact any wave cloud infrastructure)
// if you've turned off telemetry in your local client, this data never gets sent to us
// no parameters or timestamps are sent, as you can see below, it just sends the name of the command (and if there was an error)
// (e.g. "wsh ai ..." would send "ai")
// this helps us understand which commands are actually being used so we know where to concentrate our effort
func sendActivity(wshCmdName string, success bool) {
	if RpcClient == nil || wshCmdName == "" {
		return
	}
	dataMap := make(map[string]int)
	dataMap[wshCmdName] = 1
	if !success {
		dataMap[wshCmdName+"#"+"error"] = 1
	}
	wshclient.WshActivityCommand(RpcClient, dataMap, nil)
}

// Execute executes the root command.
func Execute() {
	defer func() {
		r := recover()
		if r != nil {
			WriteStderr("[panic] %v\n", r)
			debug.PrintStack()
			wshutil.DoShutdown("", 1, true)
		} else {
			wshutil.DoShutdown("", WshExitCode, false)
		}
	}()
	rootCmd.PersistentFlags().StringVarP(&blockArg, "block", "b", "", "for commands which require a block id")
	err := rootCmd.Execute()
	if err != nil {
		wshutil.DoShutdown("", 1, true)
		return
	}
}
