// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"errors"
	"os/exec"
	"testing"
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
	if containers[1].PortsText != "" {
		t.Fatalf("expected empty ports text, got %q", containers[1].PortsText)
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
	if images[1].InUse {
		t.Fatalf("expected second image to not be marked in use")
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
			name:   "not found",
			err:    errors.New("exit status 1"),
			stderr: "Error response from daemon: No such container: missing",
			code:   "not_found",
		},
		{
			name:   "conflict",
			err:    errors.New("exit status 1"),
			stderr: "conflict: unable to remove repository reference",
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
