// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"errors"
	"os/exec"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestParseDockerContainerSummaries(t *testing.T) {
	output := "abc123\tweb\tnginx:latest\trunning\tUp 2 minutes\t0.0.0.0:80->80/tcp\n" +
		"def456\tworker\tbusybox\texited\tExited (0) 3 hours ago\t\n"
	containers, err := parseDockerContainerSummaries(output)
	if err != nil {
		t.Fatalf("parseDockerContainerSummaries returned error: %v", err)
	}
	if len(containers) != 2 {
		t.Fatalf("expected 2 containers, got %d", len(containers))
	}
	if containers[0].Name != "web" || containers[0].State != "running" {
		t.Fatalf("unexpected first container: %+v", containers[0])
	}
	if containers[0].PortsText != "0.0.0.0:80->80/tcp" {
		t.Fatalf("expected ports text for first container, got %q", containers[0].PortsText)
	}
	if containers[1].PortsText != "" {
		t.Fatalf("expected empty ports text, got %q", containers[1].PortsText)
	}
	if containers[1].State != "exited" {
		t.Fatalf("expected exited state, got %q", containers[1].State)
	}
}

func TestParseDockerContainerSummariesEmpty(t *testing.T) {
	containers, err := parseDockerContainerSummaries("")
	if err != nil {
		t.Fatalf("parseDockerContainerSummaries returned error: %v", err)
	}
	if len(containers) != 0 {
		t.Fatalf("expected 0 containers, got %d", len(containers))
	}
}

func TestParseDockerContainerSummariesInvalidRow(t *testing.T) {
	_, err := parseDockerContainerSummaries("only\tthree\tfields")
	if err == nil {
		t.Fatal("expected error for invalid row, got nil")
	}
}

func TestParseDockerContainerSummariesTrimsWhitespace(t *testing.T) {
	output := " abc123 \t web \t nginx:latest \t running \t Up 2 minutes \t \n"
	containers, err := parseDockerContainerSummaries(output)
	if err != nil {
		t.Fatalf("parseDockerContainerSummaries returned error: %v", err)
	}
	if len(containers) != 1 {
		t.Fatalf("expected 1 container, got %d", len(containers))
	}
	if containers[0].Id != "abc123" {
		t.Fatalf("expected trimmed id 'abc123', got %q", containers[0].Id)
	}
	if containers[0].Name != "web" {
		t.Fatalf("expected trimmed name 'web', got %q", containers[0].Name)
	}
}

func TestParseDockerContainerSummariesMixedLineEndings(t *testing.T) {
	output := "abc123\tweb\tnginx:latest\trunning\tUp 2 minutes\t80/tcp\r\ndef456\tworker\tbusybox\texited\tExited\t\n"
	containers, err := parseDockerContainerSummaries(output)
	if err != nil {
		t.Fatalf("parseDockerContainerSummaries returned error: %v", err)
	}
	if len(containers) != 2 {
		t.Fatalf("expected 2 containers, got %d", len(containers))
	}
}

func TestParseDockerImageSummaries(t *testing.T) {
	output := "sha256:123\tnginx\tlatest\t187MB\t2\n" +
		"sha256:456\t<none>\t<none>\t98MB\t0\n"
	images, err := parseDockerImageSummaries(output)
	if err != nil {
		t.Fatalf("parseDockerImageSummaries returned error: %v", err)
	}
	if len(images) != 2 {
		t.Fatalf("expected 2 images, got %d", len(images))
	}
	if !images[0].InUse {
		t.Fatalf("expected first image to be marked in use")
	}
	if images[0].Containers != 2 {
		t.Fatalf("expected first image containers=2, got %d", images[0].Containers)
	}
	if images[1].InUse {
		t.Fatalf("expected second image to not be marked in use")
	}
	if images[1].Containers != 0 {
		t.Fatalf("expected second image containers=0, got %d", images[1].Containers)
	}
}

func TestParseDockerImageSummariesEmpty(t *testing.T) {
	images, err := parseDockerImageSummaries("")
	if err != nil {
		t.Fatalf("parseDockerImageSummaries returned error: %v", err)
	}
	if len(images) != 0 {
		t.Fatalf("expected 0 images, got %d", len(images))
	}
}

func TestParseDockerImageSummariesInvalidRow(t *testing.T) {
	_, err := parseDockerImageSummaries("only\tthree\tfields")
	if err == nil {
		t.Fatal("expected error for invalid row, got nil")
	}
}

func TestParseDockerImageContainersAndInUse(t *testing.T) {
	tests := []struct {
		name            string
		raw             string
		expectedCount   int
		expectedInUse   bool
	}{
		{"zero", "0", 0, false},
		{"positive", "3", 3, true},
		{"empty", "", 0, false},
		{"n/a case insensitive", "N/A", 0, false},
		{"non-numeric defaults to in-use", "unknown", 0, true},
		{"whitespace trimmed", "  5  ", 5, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			count, inUse := parseDockerImageContainersAndInUse(tc.raw)
			if count != tc.expectedCount {
				t.Fatalf("expected count %d, got %d", tc.expectedCount, count)
			}
			if inUse != tc.expectedInUse {
				t.Fatalf("expected inUse %v, got %v", tc.expectedInUse, inUse)
			}
		})
	}
}

func TestNormalizeDockerContainerState(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"running", "running"},
		{"Running", "running"},
		{"  exited  ", "exited"},
		{"PAUSED", "paused"},
		{"", ""},
		{"  ", ""},
		{"removing", "removing"},
		{"configured", "configured"},
	}

	for _, tc := range tests {
		t.Run(tc.input, func(t *testing.T) {
			result := normalizeDockerContainerState(tc.input)
			if result != tc.expected {
				t.Fatalf("expected %q, got %q", tc.expected, result)
			}
		})
	}
}

func TestMakeDockerError(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		stderr string
		code   string
	}{
		{
			name: "missing cli",
			err:  errors.Join(exec.ErrNotFound),
			code: "missing_cli",
		},
		{
			name:   "daemon unreachable",
			err:    errors.New("exit status 1"),
			stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
			code:   "daemon_unreachable",
		},
		{
			name:   "permission denied",
			err:    errors.New("exit status 1"),
			stderr: "permission denied while trying to connect to the Docker daemon socket",
			code:   "permission_denied",
		},
		{
			name:   "not found container",
			err:    errors.New("exit status 1"),
			stderr: "Error response from daemon: No such container: missing",
			code:   "not_found",
		},
		{
			name:   "not found image",
			err:    errors.New("exit status 1"),
			stderr: "Error response from daemon: No such image: missing",
			code:   "not_found",
		},
		{
			name:   "conflict",
			err:    errors.New("exit status 1"),
			stderr: "conflict: unable to remove repository reference",
			code:   "conflict",
		},
		{
			name:   "running container conflict",
			err:    errors.New("exit status 1"),
			stderr: "image is being used by running container abc123",
			code:   "conflict",
		},
		{
			name:   "must be forced conflict",
			err:    errors.New("exit status 1"),
			stderr: "must be forced",
			code:   "conflict",
		},
		{
			name:   "unknown error",
			err:    errors.New("exit status 1"),
			stderr: "some unexpected error",
			code:   "unknown",
		},
		{
			name:   "error during connect",
			err:    errors.New("exit status 1"),
			stderr: "error during connect: This error may indicate that the docker daemon is not running",
			code:   "daemon_unreachable",
		},
		{
			name:   "docker daemon not running",
			err:    errors.New("exit status 1"),
			stderr: "Docker daemon is not running",
			code:   "daemon_unreachable",
		},
		{
			name:   "command not found",
			err:    errors.New("exit status 127"),
			stderr: "docker: command not found",
			code:   "missing_cli",
		},
		{
			name:   "windows not recognized",
			err:    errors.New("exit status 1"),
			stderr: "'docker' is not recognized as an internal or external command",
			code:   "missing_cli",
		},
		{
			name:   "container is running conflict",
			err:    errors.New("exit status 1"),
			stderr: "container is running, cannot remove",
			code:   "conflict",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dockerErr := makeDockerError(tc.err, "", tc.stderr)
			if dockerErr.Code != tc.code {
				t.Fatalf("expected code %q, got %q", tc.code, dockerErr.Code)
			}
		})
	}
}

func TestMakeDockerErrorFallsBackToStdout(t *testing.T) {
	err := errors.New("exit status 1")
	dockerErr := makeDockerError(err, "stdout detail", "")
	if dockerErr.Detail != "stdout detail" {
		t.Fatalf("expected detail from stdout, got %q", dockerErr.Detail)
	}
}

func TestMakeDockerErrorFallsBackToErrError(t *testing.T) {
	err := errors.New("some go error")
	dockerErr := makeDockerError(err, "", "")
	if dockerErr.Detail != "some go error" {
		t.Fatalf("expected detail from error, got %q", dockerErr.Detail)
	}
}

func TestSplitNonEmptyLines(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected int
	}{
		{"empty", "", 0},
		{"single line", "hello", 1},
		{"multiple lines", "line1\nline2\nline3", 3},
		{"trailing newline", "line1\nline2\n", 2},
		{"blank lines", "line1\n\n\nline2\n", 2},
		{"whitespace only lines", "line1\n   \nline2\n", 2},
		{"crlf", "line1\r\nline2\r\n", 2},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			lines := splitNonEmptyLines(tc.input)
			if len(lines) != tc.expected {
				t.Fatalf("expected %d lines, got %d", tc.expected, len(lines))
			}
		})
	}
}

func TestDockerListContainersArgs(t *testing.T) {
	argsWithoutAll := dockerListContainersArgs(false)
	if argsWithoutAll[0] != "ps" {
		t.Fatalf("expected first arg 'ps', got %q", argsWithoutAll[0])
	}
	hasAll := false
	for _, arg := range argsWithoutAll {
		if arg == "-a" {
			hasAll = true
		}
	}
	if hasAll {
		t.Fatal("expected no -a flag when all=false")
	}

	argsWithAll := dockerListContainersArgs(true)
	hasAll = false
	for _, arg := range argsWithAll {
		if arg == "-a" {
			hasAll = true
		}
	}
	if !hasAll {
		t.Fatal("expected -a flag when all=true")
	}
}

func TestDockerListImagesArgs(t *testing.T) {
	args := dockerListImagesArgs()
	if args[0] != "image" || args[1] != "ls" {
		t.Fatalf("expected first args to be 'image ls', got %q %q", args[0], args[1])
	}
	hasFormat := false
	for _, arg := range args {
		if arg == "--format" {
			hasFormat = true
		}
	}
	if !hasFormat {
		t.Fatal("expected --format flag in image list args")
	}
}

func TestDockerContainerActionArgs(t *testing.T) {
	tests := []struct {
		name        string
		action      string
		containerId string
		newName     string
		expectArgs  []string
		expectError bool
	}{
		{"start", "start", "abc123", "", []string{"start", "abc123"}, false},
		{"stop", "stop", "abc123", "", []string{"stop", "abc123"}, false},
		{"kill", "kill", "abc123", "", []string{"kill", "abc123"}, false},
		{"restart", "restart", "abc123", "", []string{"restart", "abc123"}, false},
		{"remove", "remove", "abc123", "", []string{"rm", "abc123"}, false},
		{"rename", "rename", "abc123", "new-name", []string{"rename", "abc123", "new-name"}, false},
		{"rename empty name", "rename", "abc123", "", nil, true},
		{"unsupported", "pause", "abc123", "", nil, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data := wshrpc.DockerContainerActionRequest{
				ContainerId: tc.containerId,
				Action:      tc.action,
				NewName:     tc.newName,
			}
			var args []string
			switch data.Action {
			case "start":
				args = []string{"start", data.ContainerId}
			case "stop":
				args = []string{"stop", data.ContainerId}
			case "kill":
				args = []string{"kill", data.ContainerId}
			case "restart":
				args = []string{"restart", data.ContainerId}
			case "remove":
				args = []string{"rm", data.ContainerId}
			case "rename":
				newName := strings.TrimSpace(data.NewName)
				if newName == "" {
					if !tc.expectError {
						t.Fatal("expected error for empty rename, got none")
					}
					return
				}
				args = []string{"rename", data.ContainerId, newName}
			default:
				if !tc.expectError {
					t.Fatalf("expected error for unsupported action %q, got none", tc.action)
				}
				return
			}
			if tc.expectError {
				t.Fatalf("expected error, got args: %v", args)
			}
			if len(args) != len(tc.expectArgs) {
				t.Fatalf("expected %v, got %v", tc.expectArgs, args)
			}
			for i, arg := range args {
				if arg != tc.expectArgs[i] {
					t.Fatalf("at index %d: expected %q, got %q", i, tc.expectArgs[i], arg)
				}
			}
		})
	}
}
