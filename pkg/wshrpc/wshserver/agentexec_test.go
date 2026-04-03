// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

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
	origReadOutputTail := agentReadOutputTail
	origWriteOutput := agentWriteOutput

	t.Cleanup(func() {
		agentRunCommandExecutor = origExecutor
		agentMakeOutputFile = origMakeOutputFile
		agentInsertJob = origInsertJob
		agentUpdateJob = origUpdateJob
		agentGetJob = origGetJob
		agentReadOutputTail = origReadOutputTail
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
	agentReadOutputTail = func(ctx context.Context, jobId string, tailBytes int64) (string, error) {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.outputs[jobId], nil
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
