// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bufio"
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobcontroller"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type fakeInteractiveProc struct {
	stdinR    *io.PipeReader
	stdinW    *io.PipeWriter
	stdoutR   *io.PipeReader
	stdoutW   *io.PipeWriter
	stderrR   *io.PipeReader
	stderrW   *io.PipeWriter
	waitCh    chan error
	killed    bool
	killMutex sync.Mutex
}

func newFakeInteractiveProc() *fakeInteractiveProc {
	stdinR, stdinW := io.Pipe()
	stdoutR, stdoutW := io.Pipe()
	stderrR, stderrW := io.Pipe()
	return &fakeInteractiveProc{
		stdinR:  stdinR,
		stdinW:  stdinW,
		stdoutR: stdoutR,
		stdoutW: stdoutW,
		stderrR: stderrR,
		stderrW: stderrW,
		waitCh:  make(chan error, 1),
	}
}

func (p *fakeInteractiveProc) Start() error {
	go func() {
		_, _ = p.stdoutW.Write([]byte("Enter your name: "))
		line, _ := bufio.NewReader(p.stdinR).ReadString('\n')
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			_, _ = p.stderrW.Write([]byte("no input received"))
			p.waitCh <- nil
			return
		}
		_, _ = p.stdoutW.Write([]byte("hello " + trimmed + "\n"))
		_ = p.stdoutW.Close()
		_ = p.stderrW.Close()
		p.waitCh <- nil
	}()
	return nil
}

func (p *fakeInteractiveProc) Wait() error {
	return <-p.waitCh
}

func (p *fakeInteractiveProc) Kill() {
	p.killMutex.Lock()
	defer p.killMutex.Unlock()
	if p.killed {
		return
	}
	p.killed = true
	_ = p.stdoutW.Close()
	_ = p.stderrW.Close()
	_ = p.stdinW.Close()
	select {
	case p.waitCh <- context.Canceled:
	default:
	}
}

func (p *fakeInteractiveProc) StdinPipe() (io.WriteCloser, error) {
	return p.stdinW, nil
}

func (p *fakeInteractiveProc) StdoutPipe() (io.Reader, error) {
	return p.stdoutR, nil
}

func (p *fakeInteractiveProc) StderrPipe() (io.Reader, error) {
	return p.stderrR, nil
}

type agentTestStore struct {
	mu      sync.Mutex
	jobs    map[string]*waveobj.Job
	outputs map[string]string
}

func newAgentTestStore() *agentTestStore {
	return &agentTestStore{
		jobs:    make(map[string]*waveobj.Job),
		outputs: make(map[string]string),
	}
}

func (s *agentTestStore) install(t *testing.T) {
	t.Helper()
	origExecutor := agentRunCommandExecutor
	origMakeOutputFile := agentMakeOutputFile
	origInsertJob := agentInsertJob
	origUpdateJob := agentUpdateJob
	origGetJob := agentGetJob
	origReadOutputRange := agentReadOutputRange
	origWriteOutput := agentWriteOutput

	t.Cleanup(func() {
		agentRunCommandExecutor = origExecutor
		agentMakeOutputFile = origMakeOutputFile
		agentInsertJob = origInsertJob
		agentUpdateJob = origUpdateJob
		agentGetJob = origGetJob
		agentReadOutputRange = origReadOutputRange
		agentWriteOutput = origWriteOutput
	})

	agentMakeOutputFile = func(ctx context.Context, jobId string) error {
		return nil
	}
	agentInsertJob = func(ctx context.Context, job *waveobj.Job) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		copyJob := *job
		s.jobs[job.OID] = &copyJob
		return nil
	}
	agentUpdateJob = func(ctx context.Context, jobId string, fn func(job *waveobj.Job)) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		job := s.jobs[jobId]
		if job == nil {
			return nil
		}
		fn(job)
		return nil
	}
	agentGetJob = func(ctx context.Context, jobId string) (*waveobj.Job, error) {
		s.mu.Lock()
		defer s.mu.Unlock()
		job := s.jobs[jobId]
		if job == nil {
			return nil, nil
		}
		copyJob := *job
		return &copyJob, nil
	}
	agentReadOutputRange = func(ctx context.Context, jobId string, tailBytes int64, offset *int64) (agentOutputReadResult, error) {
		s.mu.Lock()
		defer s.mu.Unlock()
		output := s.outputs[jobId]
		if tailBytes <= 0 {
			tailBytes = 32768
		}
		fullLen := int64(len(output))
		if offset != nil {
			readOffset := *offset
			if readOffset < 0 {
				readOffset = 0
			}
			if readOffset > fullLen {
				readOffset = fullLen
			}
			end := fullLen
			truncated := false
			if end-readOffset > tailBytes {
				end = readOffset + tailBytes
				truncated = true
			}
			return agentOutputReadResult{
				Output:       output[int(readOffset):int(end)],
				OutputOffset: readOffset,
				NextOffset:   end,
				Truncated:    truncated,
			}, nil
		}
		readOffset := fullLen - tailBytes
		if readOffset < 0 {
			readOffset = 0
		}
		return agentOutputReadResult{
			Output:       output[int(readOffset):],
			OutputOffset: readOffset,
			NextOffset:   fullLen,
			Truncated:    readOffset > 0,
		}, nil
	}
	agentWriteOutput = func(ctx context.Context, jobId string, output string) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.outputs[jobId] = output
		return nil
	}
	agentRunCommandExecutor = func(ctx context.Context, data agentRunCommandInput) (*agentRunCommandResult, error) {
		code := 0
		return &agentRunCommandResult{
			Stdout:   "hello from agent\n",
			ExitCode: &code,
		}, nil
	}
}

func TestAgentRunCommandCommand_WritesResultToWaveFS(t *testing.T) {
	store := newAgentTestStore()
	store.install(t)

	resp, err := (&WshServer{}).AgentRunCommandCommand(context.Background(), wshrpc.CommandAgentRunCommandData{
		ConnName: "local",
		Cmd:      "echo",
		Args:     []string{"hello"},
	})
	if err != nil {
		t.Fatalf("AgentRunCommandCommand returned error: %v", err)
	}
	if resp == nil || resp.JobId == "" {
		t.Fatalf("expected job id, got %#v", resp)
	}

	result := waitForAgentCommandResult(t, resp.JobId, 5*time.Second)
	if result.Status != "done" {
		t.Fatalf("expected done status, got %#v", result.Status)
	}
	if result.Output != "hello from agent\n" {
		t.Fatalf("expected output to be written, got %q", result.Output)
	}
	if result.ExitCode == nil || *result.ExitCode != 0 {
		t.Fatalf("expected exit code 0, got %#v", result.ExitCode)
	}
}

func TestAgentGetCommandResultCommand_ReportsDurationMs(t *testing.T) {
	store := newAgentTestStore()
	store.install(t)

	jobId := "job-duration"
	if err := agentInsertJob(context.Background(), &waveobj.Job{
		OID:              jobId,
		JobManagerStatus: jobcontroller.JobManagerStatus_Done,
		CmdStartTs:       1_000,
		CmdExitTs:        2_250,
	}); err != nil {
		t.Fatalf("agentInsertJob returned error: %v", err)
	}

	result, err := (&WshServer{}).AgentGetCommandResultCommand(context.Background(), wshrpc.CommandAgentGetCommandResultData{
		JobId:     jobId,
		TailBytes: 32768,
	})
	if err != nil {
		t.Fatalf("AgentGetCommandResultCommand returned error: %v", err)
	}
	if result.DurationMs != 1_250 {
		t.Fatalf("expected duration 1250ms, got %#v", result.DurationMs)
	}
}

func TestAgentGetCommandResultCommand_UsesOffsetIncrementalOutput(t *testing.T) {
	store := newAgentTestStore()
	store.install(t)

	jobId := "job-offset"
	if err := agentInsertJob(context.Background(), &waveobj.Job{
		OID:              jobId,
		JobManagerStatus: jobcontroller.JobManagerStatus_Done,
	}); err != nil {
		t.Fatalf("agentInsertJob returned error: %v", err)
	}
	store.mu.Lock()
	store.outputs[jobId] = "abcdef"
	store.mu.Unlock()

	offset := int64(2)
	result, err := (&WshServer{}).AgentGetCommandResultCommand(context.Background(), wshrpc.CommandAgentGetCommandResultData{
		JobId:     jobId,
		TailBytes: 3,
		Offset:    &offset,
	})
	if err != nil {
		t.Fatalf("AgentGetCommandResultCommand returned error: %v", err)
	}
	if result.Output != "cde" {
		t.Fatalf("expected incremental output cde, got %q", result.Output)
	}
	if result.OutputOffset != 2 || result.NextOffset != 5 {
		t.Fatalf("expected output offsets 2->5, got %d->%d", result.OutputOffset, result.NextOffset)
	}
	if !result.Truncated {
		t.Fatalf("expected truncated=true for capped incremental read")
	}
}

func TestAgentGetCommandResultCommand_TailFallbackRemainsCompatible(t *testing.T) {
	store := newAgentTestStore()
	store.install(t)

	jobId := "job-tail-fallback"
	if err := agentInsertJob(context.Background(), &waveobj.Job{
		OID:              jobId,
		JobManagerStatus: jobcontroller.JobManagerStatus_Done,
	}); err != nil {
		t.Fatalf("agentInsertJob returned error: %v", err)
	}
	store.mu.Lock()
	store.outputs[jobId] = "abcdef"
	store.mu.Unlock()

	result, err := (&WshServer{}).AgentGetCommandResultCommand(context.Background(), wshrpc.CommandAgentGetCommandResultData{
		JobId:     jobId,
		TailBytes: 3,
	})
	if err != nil {
		t.Fatalf("AgentGetCommandResultCommand returned error: %v", err)
	}
	if result.Output != "def" {
		t.Fatalf("expected tail output def, got %q", result.Output)
	}
	if result.OutputOffset != 3 || result.NextOffset != 6 {
		t.Fatalf("expected output offsets 3->6, got %d->%d", result.OutputOffset, result.NextOffset)
	}
	if !result.Truncated {
		t.Fatalf("expected truncated=true for tail fallback when output is trimmed")
	}
}

func TestCommandDurationMs(t *testing.T) {
	if got := commandDurationMs(1_000, 2_250); got != 1_250 {
		t.Fatalf("expected 1250ms, got %d", got)
	}
	if got := commandDurationMs(1_000, 0); got <= 0 {
		t.Fatalf("expected positive running duration, got %d", got)
	}
	if got := commandDurationMs(0, 2_250); got != 0 {
		t.Fatalf("expected zero duration when start is missing, got %d", got)
	}
}

func TestRunCommandDirect_LocalExec(t *testing.T) {
	result, err := runCommandDirect(context.Background(), agentRunCommandInput{
		ConnName: "local",
		Cmd:      "go",
		Args:     []string{"version"},
	})
	if err != nil {
		t.Fatalf("runCommandDirect returned error: %v", err)
	}
	if result.ExitSignal != "" {
		t.Fatalf("expected no exit signal, got %q", result.ExitSignal)
	}
	if result.ExitCode == nil || *result.ExitCode != 0 {
		t.Fatalf("expected exit code 0, got %#v", result.ExitCode)
	}
	if result.Stderr != "" {
		t.Fatalf("expected empty stderr, got %q", result.Stderr)
	}
	if !strings.Contains(result.Stdout, "go version") {
		t.Fatalf("expected go version output, got %q", result.Stdout)
	}
}

func TestAgentRunCommandCommand_RejectsEmptyCommand(t *testing.T) {
	_, err := (&WshServer{}).AgentRunCommandCommand(context.Background(), wshrpc.CommandAgentRunCommandData{
		ConnName: "local",
		Cmd:      " ",
	})
	if err == nil {
		t.Fatalf("expected error for empty command")
	}
	if !strings.Contains(err.Error(), "command is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func waitForAgentCommandResult(t *testing.T, jobId string, timeout time.Duration) *wshrpc.CommandAgentGetCommandResultRtnData {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		result, err := (&WshServer{}).AgentGetCommandResultCommand(context.Background(), wshrpc.CommandAgentGetCommandResultData{
			JobId:     jobId,
			TailBytes: 32768,
		})
		if err == nil && result != nil && (result.Status == "done" || result.Status == "error") {
			return result
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for job %s to finish", jobId)
	return nil
}

func TestAgentInteractiveCommand_AllowsInputAndReportsInteractionState(t *testing.T) {
	store := newAgentTestStore()
	store.install(t)

	origMakeInteractiveController := agentMakeInteractiveController
	t.Cleanup(func() {
		agentMakeInteractiveController = origMakeInteractiveController
	})

	proc := newFakeInteractiveProc()
	agentMakeInteractiveController = func(ctx context.Context, input agentRunCommandInput) (agentInteractiveController, error) {
		return proc, nil
	}

	resp, err := (&WshServer{}).AgentRunCommandCommand(context.Background(), wshrpc.CommandAgentRunCommandData{
		ConnName:     "local",
		Cmd:          "fake-interactive",
		Interactive:  true,
		PromptHint:   "Enter your name",
		InputOptions: []string{"alice", "bob"},
	})
	if err != nil {
		t.Fatalf("AgentRunCommandCommand returned error: %v", err)
	}

	running, err := (&WshServer{}).AgentGetCommandResultCommand(context.Background(), wshrpc.CommandAgentGetCommandResultData{
		JobId: resp.JobId,
	})
	if err != nil {
		t.Fatalf("AgentGetCommandResultCommand returned error: %v", err)
	}
	if !running.Interactive || !running.AwaitingInput {
		t.Fatalf("expected interactive awaiting-input state, got %#v", running)
	}
	if running.PromptHint != "Enter your name" {
		t.Fatalf("unexpected prompt hint: %#v", running.PromptHint)
	}
	if len(running.InputOptions) != 2 {
		t.Fatalf("expected input options to round-trip, got %#v", running.InputOptions)
	}

	if err := (&WshServer{}).AgentWriteStdinCommand(context.Background(), wshrpc.CommandAgentWriteStdinData{
		JobId:           resp.JobId,
		Input:           "alex",
		AppendNewline:   true,
		ClearPromptHint: true,
	}); err != nil {
		t.Fatalf("AgentWriteStdinCommand returned error: %v", err)
	}

	result := waitForAgentCommandResult(t, resp.JobId, 5*time.Second)
	if result.Status != "done" {
		t.Fatalf("expected done status, got %#v", result.Status)
	}
	if !strings.Contains(result.Output, "hello alex") {
		t.Fatalf("expected interactive output in result, got %#v", result.Output)
	}
}
