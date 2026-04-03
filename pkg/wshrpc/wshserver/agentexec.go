// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"syscall"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/jobcontroller"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/unixutil"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
	"github.com/wavetermdev/waveterm/pkg/wstore"
	"golang.org/x/crypto/ssh"
)

type agentRunCommandInput struct {
	ConnName string
	Cwd      string
	Cmd      string
	Args     []string
	Env      map[string]string
}

type agentRunCommandResult struct {
	Stdout     string
	Stderr     string
	ExitCode   *int
	ExitSignal string
	Err        string
}

type agentRunCommandExecutorFunc func(ctx context.Context, input agentRunCommandInput) (*agentRunCommandResult, error)

var agentRunCommandExecutor agentRunCommandExecutorFunc = runCommandDirect
var agentMakeOutputFile = func(ctx context.Context, jobId string) error {
	return filestore.WFS.MakeFile(ctx, jobId, jobcontroller.JobOutputFileName, wshrpc.FileMeta{}, wshrpc.FileOpts{
		MaxSize:  10 * 1024 * 1024,
		Circular: true,
	})
}
var agentInsertJob = func(ctx context.Context, job *waveobj.Job) error {
	return wstore.DBInsert(ctx, job)
}
var agentUpdateJob = func(ctx context.Context, jobId string, fn func(job *waveobj.Job)) error {
	return wstore.DBUpdateFn(ctx, jobId, fn)
}
var agentGetJob = func(ctx context.Context, jobId string) (*waveobj.Job, error) {
	return wstore.DBGet[*waveobj.Job](ctx, jobId)
}
var agentReadOutputTail = func(ctx context.Context, jobId string, tailBytes int64) (string, error) {
	waveFile, statErr := filestore.WFS.Stat(ctx, jobId, jobcontroller.JobOutputFileName)
	if statErr != nil {
		return "", statErr
	}
	if waveFile == nil || waveFile.Size == 0 {
		return "", nil
	}
	if tailBytes <= 0 {
		tailBytes = 32768
	}
	offset := waveFile.Size - tailBytes
	if offset < 0 {
		offset = 0
	}
	_, readData, readErr := filestore.WFS.ReadAt(ctx, jobId, jobcontroller.JobOutputFileName, offset, tailBytes)
	if readErr != nil {
		return "", readErr
	}
	return string(readData), nil
}
var agentWriteOutput = func(ctx context.Context, jobId string, output string) error {
	if strings.TrimSpace(output) == "" {
		return nil
	}
	if err := filestore.WFS.WriteFile(ctx, jobId, jobcontroller.JobOutputFileName, []byte(output)); err != nil {
		return err
	}
	job, err := agentGetJob(ctx, jobId)
	if err != nil {
		return err
	}
	if job != nil && job.AttachedBlockId != "" {
		if err := filestore.WFS.WriteFile(ctx, job.AttachedBlockId, jobcontroller.JobOutputFileName, []byte(output)); err != nil {
			return err
		}
	}
	return nil
}

func runCommandDirect(ctx context.Context, input agentRunCommandInput) (*agentRunCommandResult, error) {
	switch {
	case conncontroller.IsLocalConnName(input.ConnName):
		return runLocalCommandDirect(ctx, input), nil
	case conncontroller.IsWslConnName(input.ConnName):
		distroName := strings.TrimPrefix(input.ConnName, "wsl://")
		if err := wslconn.EnsureConnection(ctx, distroName); err != nil {
			return nil, err
		}
		conn := wslconn.GetWslConn(distroName)
		if conn == nil {
			return nil, fmt.Errorf("wsl connection not found: %s", input.ConnName)
		}
		client := conn.GetClient()
		if client == nil {
			return nil, fmt.Errorf("wsl client unavailable: %s", input.ConnName)
		}
		return runShellClientDirect(ctx, genconn.MakeWSLShellClient(client), input)
	default:
		if err := conncontroller.EnsureConnection(ctx, input.ConnName); err != nil {
			return nil, err
		}
		connOpts, err := remote.ParseOpts(input.ConnName)
		if err != nil {
			return nil, fmt.Errorf("invalid ssh connection %q: %w", input.ConnName, err)
		}
		conn := conncontroller.GetConn(connOpts)
		if conn == nil {
			return nil, fmt.Errorf("ssh connection not found: %s", input.ConnName)
		}
		client := conn.GetClient()
		if client == nil {
			return nil, fmt.Errorf("ssh client unavailable: %s", input.ConnName)
		}
		return runShellClientDirect(ctx, genconn.MakeSSHShellClient(client), input)
	}
}

func runShellClientDirect(ctx context.Context, client genconn.ShellClient, input agentRunCommandInput) (*agentRunCommandResult, error) {
	proc, err := client.MakeProcessController(genconn.CommandSpec{
		Cmd: buildShellCommand(input.Cmd, input.Args),
		Env: input.Env,
		Cwd: input.Cwd,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create process controller: %w", err)
	}

	stdoutPipe, err := proc.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	stderrPipe, err := proc.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("failed to get stderr pipe: %w", err)
	}
	if err := proc.Start(); err != nil {
		return nil, fmt.Errorf("failed to start command: %w", err)
	}

	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	var stdoutErr, stderrErr error
	doneCh := make(chan struct{}, 2)
	go func() {
		_, stdoutErr = io.Copy(&stdoutBuf, stdoutPipe)
		doneCh <- struct{}{}
	}()
	go func() {
		_, stderrErr = io.Copy(&stderrBuf, stderrPipe)
		doneCh <- struct{}{}
	}()

	waitErr := waitForProcess(ctx, proc)
	<-doneCh
	<-doneCh
	if stdoutErr != nil && !errors.Is(stdoutErr, io.EOF) {
		return nil, fmt.Errorf("error reading stdout: %w", stdoutErr)
	}
	if stderrErr != nil && !errors.Is(stderrErr, io.EOF) {
		return nil, fmt.Errorf("error reading stderr: %w", stderrErr)
	}

	result := &agentRunCommandResult{
		Stdout: stdoutBuf.String(),
		Stderr: stderrBuf.String(),
	}
	result.ExitCode, result.ExitSignal = exitInfoFromWaitErr(waitErr)
	if waitErr != nil {
		result.Err = waitErr.Error()
	}
	return result, nil
}

func runLocalCommandDirect(ctx context.Context, input agentRunCommandInput) *agentRunCommandResult {
	cmd := exec.CommandContext(ctx, input.Cmd, input.Args...)
	cmd.Env = os.Environ()
	shellutil.UpdateCmdEnv(cmd, input.Env)
	if input.Cwd != "" {
		cmd.Dir = input.Cwd
	}

	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	runErr := cmd.Run()
	result := &agentRunCommandResult{
		Stdout: stdoutBuf.String(),
		Stderr: stderrBuf.String(),
	}
	result.ExitCode, result.ExitSignal = exitInfoFromWaitErr(runErr)
	if runErr != nil {
		result.Err = runErr.Error()
	}
	return result
}

func waitForProcess(ctx context.Context, proc genconn.ShellProcessController) error {
	doneCh := make(chan error, 1)
	go func() {
		doneCh <- proc.Wait()
	}()

	select {
	case <-ctx.Done():
		proc.Kill()
		return ctx.Err()
	case err := <-doneCh:
		return err
	}
}

func exitInfoFromWaitErr(err error) (*int, string) {
	if err == nil {
		code := 0
		return &code, ""
	}

	var exitSignal string
	if exitErr, ok := err.(*exec.ExitError); ok {
		if status, ok := exitErr.Sys().(syscall.WaitStatus); ok {
			if status.Signaled() {
				exitSignal = unixutil.GetSignalName(status.Signal())
				return nil, exitSignal
			}
			if status.Exited() {
				code := status.ExitStatus()
				return &code, ""
			}
		}
		code := exitErr.ExitCode()
		if code >= 0 {
			return &code, ""
		}
	}

	var sshExitErr *ssh.ExitError
	if errors.As(err, &sshExitErr) {
		signal := sshExitErr.Signal()
		if signal != "" {
			return nil, signal
		}
		code := sshExitErr.ExitStatus()
		return &code, ""
	}

	return nil, exitSignal
}
