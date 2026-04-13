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
	"sync"
	"syscall"
	"time"

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
	ConnName     string
	Cwd          string
	Cmd          string
	Args         []string
	Env          map[string]string
	Interactive  bool
	PromptHint   string
	InputOptions []string
	SuppressTui  bool
}

type agentRunCommandResult struct {
	Stdout     string
	Stderr     string
	ExitCode   *int
	ExitSignal string
	Err        string
}

type agentRunCommandExecutorFunc func(ctx context.Context, input agentRunCommandInput) (*agentRunCommandResult, error)
type agentInteractiveController interface {
	Start() error
	Wait() error
	Kill()
	StdinPipe() (io.WriteCloser, error)
	StdoutPipe() (io.Reader, error)
	StderrPipe() (io.Reader, error)
}

type agentInteractiveJob struct {
	jobId string

	mu            sync.Mutex
	controller    agentInteractiveController
	stdin         io.WriteCloser
	cmdStartTs    int64
	output        bytes.Buffer
	status        string
	exitCode      *int
	exitSignal    string
	errText       string
	promptHint    string
	inputOptions  []string
	awaitingInput bool
	interactive   bool
	tuiDetected   bool
	tuiSuppressed bool
}

var agentRunCommandExecutor agentRunCommandExecutorFunc = runCommandDirect
var agentMakeInteractiveController = makeInteractiveController
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
var agentInteractiveJobs = struct {
	mu   sync.Mutex
	jobs map[string]*agentInteractiveJob
}{
	jobs: make(map[string]*agentInteractiveJob),
}

func storeInteractiveJob(job *agentInteractiveJob) {
	if job == nil {
		return
	}
	agentInteractiveJobs.mu.Lock()
	defer agentInteractiveJobs.mu.Unlock()
	agentInteractiveJobs.jobs[job.jobId] = job
}

func getInteractiveJob(jobId string) *agentInteractiveJob {
	agentInteractiveJobs.mu.Lock()
	defer agentInteractiveJobs.mu.Unlock()
	return agentInteractiveJobs.jobs[jobId]
}

func deleteInteractiveJob(jobId string) {
	agentInteractiveJobs.mu.Lock()
	defer agentInteractiveJobs.mu.Unlock()
	delete(agentInteractiveJobs.jobs, jobId)
}

func (job *agentInteractiveJob) appendOutput(chunk string) {
	job.mu.Lock()
	defer job.mu.Unlock()
	if chunk == "" {
		return
	}
	job.output.WriteString(chunk)
	if detectInteractiveTUIOutput(chunk) {
		job.tuiDetected = true
		if job.tuiSuppressed {
			job.awaitingInput = false
		}
	}
}

func (job *agentInteractiveJob) snapshot(tailBytes int64) *wshrpc.CommandAgentGetCommandResultRtnData {
	job.mu.Lock()
	defer job.mu.Unlock()
	output := job.output.String()
	if tailBytes > 0 && int64(len(output)) > tailBytes {
		output = output[len(output)-int(tailBytes):]
	}
	status := job.status
	if status == "" {
		status = "running"
	}
	durationMs := commandDurationMs(job.cmdStartTs, 0)
	return &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:         job.jobId,
		Status:        status,
		Output:        output,
		DurationMs:    durationMs,
		ExitCode:      job.exitCode,
		ExitSignal:    job.exitSignal,
		Error:         job.errText,
		Interactive:   job.interactive,
		AwaitingInput: job.awaitingInput,
		PromptHint:    job.promptHint,
		InputOptions:  slicesClone(job.inputOptions),
		TuiDetected:   job.tuiDetected,
		TuiSuppressed: job.tuiSuppressed,
	}
}

func commandDurationMs(startTs int64, endTs int64) int64 {
	if startTs <= 0 {
		return 0
	}
	if endTs <= 0 {
		endTs = time.Now().UnixMilli()
	}
	if endTs < startTs {
		return 0
	}
	return endTs - startTs
}

func (job *agentInteractiveJob) writeInput(data wshrpc.CommandAgentWriteStdinData) error {
	job.mu.Lock()
	defer job.mu.Unlock()
	if job.stdin == nil {
		return fmt.Errorf("interactive stdin is unavailable")
	}
	input := data.Input
	if data.AppendNewline {
		input += "\n"
	}
	if _, err := io.WriteString(job.stdin, input); err != nil {
		return err
	}
	job.awaitingInput = false
	if data.ClearPromptHint {
		job.promptHint = ""
		job.inputOptions = nil
	}
	return nil
}

func (job *agentInteractiveJob) cancel() {
	job.mu.Lock()
	controller := job.controller
	job.mu.Unlock()
	if controller != nil {
		controller.Kill()
	}
}

func slicesClone(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	cloned := make([]string, len(values))
	copy(cloned, values)
	return cloned
}

func detectInteractiveTUIOutput(chunk string) bool {
	return strings.Contains(chunk, "\x1b[?1049h") || strings.Contains(chunk, "\x1b[?1047h")
}

func isLikelyInteractiveCommand(input agentRunCommandInput) bool {
	commandText := strings.ToLower(strings.TrimSpace(strings.Join(append([]string{input.Cmd}, input.Args...), " ")))
	if commandText == "" {
		return false
	}
	for _, marker := range []string{
		"ssh",
		"sudo",
		"mysql",
		"psql",
		"sqlite3",
		"python",
		"node",
		"irb",
		"less",
		"more",
		"top",
		"htop",
		"vim",
		"nano",
	} {
		if strings.HasPrefix(commandText, marker+" ") || commandText == marker {
			return true
		}
	}
	return false
}

type localProcessController struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
}

func makeLocalProcessController(input agentRunCommandInput) (agentInteractiveController, error) {
	cmd := exec.Command(input.Cmd, input.Args...)
	cmd.Env = os.Environ()
	shellutil.UpdateCmdEnv(cmd, input.Env)
	if input.Cwd != "" {
		cmd.Dir = input.Cwd
	}
	return &localProcessController{cmd: cmd}, nil
}

func (p *localProcessController) Start() error {
	return p.cmd.Start()
}

func (p *localProcessController) Wait() error {
	return p.cmd.Wait()
}

func (p *localProcessController) Kill() {
	if p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
	}
}

func (p *localProcessController) StdinPipe() (io.WriteCloser, error) {
	if p.stdin != nil {
		return p.stdin, nil
	}
	stdin, err := p.cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	p.stdin = stdin
	return stdin, nil
}

func (p *localProcessController) StdoutPipe() (io.Reader, error) {
	if p.stdout != nil {
		return p.stdout, nil
	}
	stdout, err := p.cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	p.stdout = stdout
	return stdout, nil
}

func (p *localProcessController) StderrPipe() (io.Reader, error) {
	if p.stderr != nil {
		return p.stderr, nil
	}
	stderr, err := p.cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	p.stderr = stderr
	return stderr, nil
}

func makeInteractiveController(ctx context.Context, input agentRunCommandInput) (agentInteractiveController, error) {
	switch {
	case conncontroller.IsLocalConnName(input.ConnName):
		return makeLocalProcessController(input)
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
		return genconn.MakeWSLShellClient(client).MakeProcessController(genconn.CommandSpec{
			Cmd: buildShellCommand(input.Cmd, input.Args),
			Env: input.Env,
			Cwd: input.Cwd,
		})
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
		return genconn.MakeSSHShellClient(client).MakeProcessController(genconn.CommandSpec{
			Cmd: buildShellCommand(input.Cmd, input.Args),
			Env: input.Env,
			Cwd: input.Cwd,
		})
	}
}

func streamInteractivePipe(job *agentInteractiveJob, reader io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			chunk := string(buf[:n])
			job.appendOutput(chunk)
			_ = agentWriteOutput(context.Background(), job.jobId, job.snapshot(0).Output)
			if job.tuiDetected && job.tuiSuppressed {
				job.mu.Lock()
				job.errText = "Interactive TUI is suppressed for AI-run commands. Open it in the terminal instead."
				job.status = "error"
				job.mu.Unlock()
				job.cancel()
			}
		}
		if err != nil {
			return
		}
	}
}

func startInteractiveAgentJob(ctx context.Context, jobId string, startTs int64, input agentRunCommandInput) error {
	controller, err := agentMakeInteractiveController(ctx, input)
	if err != nil {
		return err
	}
	stdin, err := controller.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}
	stdoutPipe, err := controller.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	stderrPipe, err := controller.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}
	job := &agentInteractiveJob{
		jobId:         jobId,
		controller:    controller,
		stdin:         stdin,
		cmdStartTs:    startTs,
		status:        "running",
		promptHint:    strings.TrimSpace(input.PromptHint),
		inputOptions:  slicesClone(input.InputOptions),
		awaitingInput: true,
		interactive:   true,
		tuiSuppressed: input.SuppressTui || isLikelyInteractiveCommand(input),
	}
	storeInteractiveJob(job)
	if err := controller.Start(); err != nil {
		deleteInteractiveJob(jobId)
		return fmt.Errorf("failed to start interactive command: %w", err)
	}

	go streamInteractivePipe(job, stdoutPipe)
	go streamInteractivePipe(job, stderrPipe)
	go func() {
		waitErr := controller.Wait()
		now := time.Now().UnixMilli()
		job.mu.Lock()
		job.awaitingInput = false
		if waitErr == nil && job.errText == "" {
			job.status = "done"
		}
		job.exitCode, job.exitSignal = exitInfoFromWaitErr(waitErr)
		if waitErr != nil && job.errText == "" {
			job.errText = waitErr.Error()
		}
		if job.errText != "" && job.status != "error" {
			job.status = "error"
		}
		output := job.output.String()
		exitCode := job.exitCode
		exitSignal := job.exitSignal
		errText := job.errText
		job.mu.Unlock()

		_ = agentWriteOutput(context.Background(), jobId, output)
		_ = agentUpdateJob(context.Background(), jobId, func(job *waveobj.Job) {
			job.JobManagerStatus = jobcontroller.JobManagerStatus_Done
			job.CmdExitTs = now
			job.StreamDone = true
			job.CmdExitCode = exitCode
			job.CmdExitSignal = exitSignal
			if errText != "" {
				job.CmdExitError = errText
			}
			jobcontroller.SetAIJobRetentionMeta(job, time.Now())
		})
		deleteInteractiveJob(jobId)
	}()
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
