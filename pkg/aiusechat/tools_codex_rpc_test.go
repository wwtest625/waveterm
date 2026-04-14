// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

func TestWaitForWaveCommandCompletion_ReturnsTerminalSnapshot(t *testing.T) {
	orig := waveAgentGetCommandResult
	defer func() {
		waveAgentGetCommandResult = orig
	}()

	calls := 0
	waveAgentGetCommandResult = func(_ *wshutil.WshRpc, _ wshrpc.CommandAgentGetCommandResultData, _ *wshrpc.RpcOpts) (*wshrpc.CommandAgentGetCommandResultRtnData, error) {
		calls++
		if calls < 3 {
			return &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-1", Status: "running"}, nil
		}
		return &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-1", Status: "done", Output: "ok"}, nil
	}

	result, err := waitForWaveCommandCompletion(nil, "job-1", 2*time.Second)
	if err != nil {
		t.Fatalf("waitForWaveCommandCompletion returned error: %v", err)
	}
	if result == nil || result.Status != "done" {
		t.Fatalf("expected done result, got %#v", result)
	}
	if calls < 3 {
		t.Fatalf("expected at least 3 polls, got %d", calls)
	}
}

func TestWaitForWaveCommandCompletion_TimeoutReturnsNil(t *testing.T) {
	orig := waveAgentGetCommandResult
	defer func() {
		waveAgentGetCommandResult = orig
	}()

	waveAgentGetCommandResult = func(_ *wshutil.WshRpc, _ wshrpc.CommandAgentGetCommandResultData, _ *wshrpc.RpcOpts) (*wshrpc.CommandAgentGetCommandResultRtnData, error) {
		return &wshrpc.CommandAgentGetCommandResultRtnData{JobId: "job-1", Status: "running"}, nil
	}

	result, err := waitForWaveCommandCompletion(nil, "job-1", 80*time.Millisecond)
	if err != nil {
		t.Fatalf("waitForWaveCommandCompletion returned error: %v", err)
	}
	if result != nil {
		t.Fatalf("expected nil result on timeout, got %#v", result)
	}
}

func TestParseWaveRunCommandToolInput_SplitsCommandWhenArgsOmitted(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "cat /proc/cpuinfo",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Command != "cat" {
		t.Fatalf("expected command to be split to cat, got %q", parsed.Command)
	}
	if len(parsed.Args) != 1 || parsed.Args[0] != "/proc/cpuinfo" {
		t.Fatalf("expected args to contain /proc/cpuinfo, got %#v", parsed.Args)
	}
}

func TestParseWaveRunCommandToolInput_AllowsMissingConnection(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"command": "uname -a",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Connection != "" {
		t.Fatalf("expected empty connection, got %q", parsed.Connection)
	}
	if parsed.Command != "uname" {
		t.Fatalf("expected command to be split to uname, got %q", parsed.Command)
	}
}

func TestParseWaveRunCommandToolInput_PreservesExplicitArgs(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "python3",
		"args":       []string{"-c", "print('ok')"},
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Command != "python3" {
		t.Fatalf("expected command to stay python3, got %q", parsed.Command)
	}
	if len(parsed.Args) != 2 || parsed.Args[0] != "-c" || parsed.Args[1] != "print('ok')" {
		t.Fatalf("expected args to stay unchanged, got %#v", parsed.Args)
	}
}

func TestParseWaveRunCommandToolInput_AcceptsStringArgs(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "python3",
		"args":       "-c",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if len(parsed.Args) != 1 || parsed.Args[0] != "-c" {
		t.Fatalf("expected string args to be preserved as a single arg, got %#v", parsed.Args)
	}
}

func TestParseWaveRunCommandToolInput_UsesShellForPipeline(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    `lscpu | grep "Model name"`,
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Command != "sh" {
		t.Fatalf("expected shell command to be sh, got %q", parsed.Command)
	}
	if len(parsed.Args) != 2 || parsed.Args[0] != "-lc" || parsed.Args[1] != `lscpu | grep "Model name"` {
		t.Fatalf("expected shell args [-lc, original], got %#v", parsed.Args)
	}
}

func TestParseWaveRunCommandToolInput_UsesShellForQuotedCommand(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    `python3 -c "print('ok')"`,
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if parsed.Command != "sh" {
		t.Fatalf("expected quoted command to run via sh, got %q", parsed.Command)
	}
	if len(parsed.Args) != 2 || parsed.Args[0] != "-lc" {
		t.Fatalf("expected shell args prefix, got %#v", parsed.Args)
	}
}

func TestExtractToolOutputText_WaveRunCommandUsesOutputField(t *testing.T) {
	output := extractToolOutputText("wave_run_command", `{"jobid":"job-123","status":"done","output":"hello\n","durationms":5,"exitcode":0}`)
	if output != "hello" {
		t.Fatalf("expected wave_run_command output field, got %q", output)
	}
}

func TestExtractToolOutputText_WaveRunCommandUsesErrorWhenOutputMissing(t *testing.T) {
	output := extractToolOutputText("wave_run_command", `{"jobid":"job-123","status":"error","error":"Process exited with status 2","durationms":5,"exitcode":2}`)
	if output != "Process exited with status 2" {
		t.Fatalf("expected wave_run_command error field, got %q", output)
	}
}

func TestParseWaveCommandResultSnapshot_ParsesInlineWaveRunCommandResult(t *testing.T) {
	snapshot, ok := parseWaveCommandResultSnapshot(`{"jobid":"job-123","status":"done","output":"ok","durationms":5,"exitcode":0}`)
	if !ok {
		t.Fatal("expected inline wave_run_command result to parse as command snapshot")
	}
	if snapshot.JobId != "job-123" || snapshot.Status != "done" || snapshot.Output != "ok" || snapshot.DurationMs != 5 {
		t.Fatalf("unexpected parsed snapshot: %#v", snapshot)
	}
	if snapshot.ExitCode == nil || *snapshot.ExitCode != 0 {
		t.Fatalf("expected exit code 0, got %#v", snapshot.ExitCode)
	}
}

func TestParseWaveCommandResultSnapshot_PreservesNonZeroExitCode(t *testing.T) {
	snapshot, ok := parseWaveCommandResultSnapshot(`{"jobid":"job-123","status":"error","output":"ls: cannot access '/missing': No such file or directory","error":"Process exited with status 2","durationms":200,"exitcode":2}`)
	if !ok {
		t.Fatal("expected non-zero command result to parse as command snapshot")
	}
	if snapshot.ExitCode == nil || *snapshot.ExitCode != 2 {
		t.Fatalf("expected exit code 2, got %#v", snapshot.ExitCode)
	}
	if !strings.Contains(snapshot.Output, "No such file or directory") {
		t.Fatalf("expected stderr output to be preserved, got %q", snapshot.Output)
	}
}

func TestValidateRemoteLinuxWaveRunCommand_RejectsLocalConnection(t *testing.T) {
	err := validateRemoteLinuxWaveRunCommand(&WaveRunCommandToolInput{
		Connection: "local",
		Command:    "uname",
	})
	if err == nil {
		t.Fatalf("expected local connection to be rejected")
	}
	if !strings.Contains(err.Error(), "local execution is disabled") {
		t.Fatalf("expected local execution error, got %v", err)
	}
}

func TestValidateRemoteLinuxWaveRunCommand_RejectsWslConnection(t *testing.T) {
	err := validateRemoteLinuxWaveRunCommand(&WaveRunCommandToolInput{
		Connection: "wsl://Ubuntu",
		Command:    "uname",
	})
	if err == nil {
		t.Fatalf("expected wsl connection to be rejected")
	}
	if !strings.Contains(err.Error(), "local execution is disabled") {
		t.Fatalf("expected local execution error, got %v", err)
	}
}

func TestValidateRemoteLinuxWaveRunCommand_RejectsWindowsShellCommand(t *testing.T) {
	err := validateRemoteLinuxWaveRunCommand(&WaveRunCommandToolInput{
		Connection: "root@example",
		Command:    "powershell",
		Args:       []string{"-Command", "Get-CimInstance Win32_OperatingSystem"},
	})
	if err == nil {
		t.Fatalf("expected windows shell command to be rejected")
	}
	if !strings.Contains(err.Error(), "linux shell commands") {
		t.Fatalf("expected linux shell error, got %v", err)
	}
}

func TestValidateRemoteLinuxWaveRunCommand_AllowsRemoteLinuxCommand(t *testing.T) {
	err := validateRemoteLinuxWaveRunCommand(&WaveRunCommandToolInput{
		Connection: "root@example",
		Command:    "uname",
		Args:       []string{"-a"},
	})
	if err != nil {
		t.Fatalf("expected remote linux command to be allowed, got %v", err)
	}
}

func TestIsLikelyStreamingWaveRunCommand_DetectsPackageInstall(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "yum install kernel-modules-extra -y",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if !isLikelyStreamingWaveRunCommand(parsed) {
		t.Fatalf("expected package install command to be treated as streaming-preferred")
	}
}

func TestIsLikelyStreamingWaveRunCommand_DetectsFollowMode(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "docker logs -f nginx",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if !isLikelyStreamingWaveRunCommand(parsed) {
		t.Fatalf("expected follow command to be treated as streaming-preferred")
	}
}

func TestIsLikelyStreamingWaveRunCommand_DetectsDownloadTransfer(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "wget https://example.com/large.iso -O /tmp/large.iso",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if !isLikelyStreamingWaveRunCommand(parsed) {
		t.Fatalf("expected transfer command to be treated as streaming-preferred")
	}
}

func TestIsLikelyStreamingWaveRunCommand_IgnoresRegularShortCommand(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "uname -a",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if isLikelyStreamingWaveRunCommand(parsed) {
		t.Fatalf("did not expect regular short command to be treated as streaming-preferred")
	}
}

func TestIsLikelyInteractiveWaveRunCommand_DetectsGitClonePromptScenario(t *testing.T) {
	parsed, err := parseWaveRunCommandToolInput(map[string]any{
		"connection": "root@example",
		"command":    "git clone https://github.com/example/private-repo.git /tmp/repo",
	})
	if err != nil {
		t.Fatalf("parseWaveRunCommandToolInput returned error: %v", err)
	}
	if !isLikelyInteractiveWaveRunCommand(parsed) {
		t.Fatalf("expected git clone over https to be treated as interactive-capable")
	}
}

func TestShouldReturnWaveCommandResult_ReturnsImmediatelyWhenDone(t *testing.T) {
	now := time.Now()
	deadline := now.Add(30 * time.Second)
	var terminalSeenAt time.Time
	result := &wshrpc.CommandAgentGetCommandResultRtnData{
		Status: "done",
		Output: "",
	}

	if !shouldReturnWaveCommandResult(result, now, deadline, &terminalSeenAt) {
		t.Fatalf("expected done result to return immediately")
	}
}

func TestShouldReturnWaveCommandResult_ReturnsWhenOutputPresent(t *testing.T) {
	now := time.Now()
	deadline := now.Add(30 * time.Second)
	var terminalSeenAt time.Time
	result := &wshrpc.CommandAgentGetCommandResultRtnData{
		Status: "done",
		Output: "Intel Xeon",
	}

	if !shouldReturnWaveCommandResult(result, now, deadline, &terminalSeenAt) {
		t.Fatalf("expected non-empty output to return immediately")
	}
}
