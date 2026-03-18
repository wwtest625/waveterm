// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
)

const dockerFieldSep = "\t"

func (ws *WshServer) DockerListContainersCommand(ctx context.Context, data wshrpc.DockerListContainersRequest) (wshrpc.DockerListContainersResponse, error) {
	stdout, stderr, err := runDockerCLI(ctx, data.Connection, dockerListContainersArgs(data.All))
	if err != nil {
		return wshrpc.DockerListContainersResponse{Error: makeDockerError(err, stdout, stderr)}, nil
	}
	containers, parseErr := parseDockerContainerSummaries(stdout)
	if parseErr != nil {
		return wshrpc.DockerListContainersResponse{
			Error: &wshrpc.DockerError{
				Code:    "unknown",
				Message: "Unable to parse Docker container list.",
				Detail:  parseErr.Error(),
			},
		}, nil
	}
	return wshrpc.DockerListContainersResponse{Containers: containers}, nil
}

func (ws *WshServer) DockerListImagesCommand(ctx context.Context, data wshrpc.DockerListImagesRequest) (wshrpc.DockerListImagesResponse, error) {
	stdout, stderr, err := runDockerCLI(ctx, data.Connection, dockerListImagesArgs())
	if err != nil {
		return wshrpc.DockerListImagesResponse{Error: makeDockerError(err, stdout, stderr)}, nil
	}
	images, parseErr := parseDockerImageSummaries(stdout)
	if parseErr != nil {
		return wshrpc.DockerListImagesResponse{
			Error: &wshrpc.DockerError{
				Code:    "unknown",
				Message: "Unable to parse Docker image list.",
				Detail:  parseErr.Error(),
			},
		}, nil
	}
	return wshrpc.DockerListImagesResponse{Images: images}, nil
}

func (ws *WshServer) DockerContainerActionCommand(ctx context.Context, data wshrpc.DockerContainerActionRequest) (wshrpc.DockerActionResponse, error) {
	var args []string
	switch data.Action {
	case "start":
		args = []string{"start", data.ContainerId}
	case "stop":
		args = []string{"stop", data.ContainerId}
	case "restart":
		args = []string{"restart", data.ContainerId}
	case "remove":
		args = []string{"rm", data.ContainerId}
	default:
		return wshrpc.DockerActionResponse{
			Error: &wshrpc.DockerError{
				Code:    "unknown",
				Message: fmt.Sprintf("Unsupported Docker container action %q.", data.Action),
			},
		}, nil
	}

	stdout, stderr, err := runDockerCLI(ctx, data.Connection, args)
	if err != nil {
		return wshrpc.DockerActionResponse{Error: makeDockerError(err, stdout, stderr)}, nil
	}
	return wshrpc.DockerActionResponse{}, nil
}

func (ws *WshServer) DockerImageActionCommand(ctx context.Context, data wshrpc.DockerImageActionRequest) (wshrpc.DockerActionResponse, error) {
	if data.Action != "remove" {
		return wshrpc.DockerActionResponse{
			Error: &wshrpc.DockerError{
				Code:    "unknown",
				Message: fmt.Sprintf("Unsupported Docker image action %q.", data.Action),
			},
		}, nil
	}

	stdout, stderr, err := runDockerCLI(ctx, data.Connection, []string{"image", "rm", data.ImageId})
	if err != nil {
		return wshrpc.DockerActionResponse{Error: makeDockerError(err, stdout, stderr)}, nil
	}
	return wshrpc.DockerActionResponse{}, nil
}

func dockerListContainersArgs(all bool) []string {
	args := []string{
		"ps",
		"--format",
		fmt.Sprintf("{{.ID}}%s{{.Names}}%s{{.Image}}%s{{.State}}%s{{.Status}}%s{{.Ports}}", dockerFieldSep, dockerFieldSep, dockerFieldSep, dockerFieldSep, dockerFieldSep),
	}
	if all {
		return append([]string{"ps", "-a", "--format"}, args[2:]...)
	}
	return args
}

func dockerListImagesArgs() []string {
	return []string{
		"image",
		"ls",
		"--format",
		fmt.Sprintf("{{.ID}}%s{{.Repository}}%s{{.Tag}}%s{{.Size}}%s{{.Containers}}", dockerFieldSep, dockerFieldSep, dockerFieldSep, dockerFieldSep),
	}
}

func runDockerCLI(ctx context.Context, connName string, args []string) (string, string, error) {
	if conncontroller.IsLocalConnName(connName) {
		return runLocalDockerCLI(ctx, args)
	}
	if conncontroller.IsWslConnName(connName) {
		distroName := strings.TrimPrefix(connName, "wsl://")
		if err := wslconn.EnsureConnection(ctx, distroName); err != nil {
			return "", "", err
		}
		conn := wslconn.GetWslConn(distroName)
		if conn == nil {
			return "", "", fmt.Errorf("wsl connection not found: %s", connName)
		}
		client := conn.GetClient()
		if client == nil {
			return "", "", fmt.Errorf("wsl client unavailable: %s", connName)
		}
		return runShellDockerCLI(ctx, genconn.MakeWSLShellClient(client), args)
	}

	if err := conncontroller.EnsureConnection(ctx, connName); err != nil {
		return "", "", err
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return "", "", fmt.Errorf("invalid ssh connection %q: %w", connName, err)
	}
	conn := conncontroller.GetConn(connOpts)
	if conn == nil {
		return "", "", fmt.Errorf("ssh connection not found: %s", connName)
	}
	client := conn.GetClient()
	if client == nil {
		return "", "", fmt.Errorf("ssh client unavailable: %s", connName)
	}
	return runShellDockerCLI(ctx, genconn.MakeSSHShellClient(client), args)
}

func runLocalDockerCLI(ctx context.Context, args []string) (string, string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	var stdoutBuf bytes.Buffer
	var stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf
	err := cmd.Run()
	return stdoutBuf.String(), stderrBuf.String(), err
}

func runShellDockerCLI(ctx context.Context, client genconn.ShellClient, args []string) (string, string, error) {
	stdout, stderr, err := genconn.RunSimpleCommand(ctx, client, genconn.CommandSpec{
		Cmd: buildDockerShellCommand(args),
	})
	return stdout, stderr, err
}

func buildDockerShellCommand(args []string) string {
	var b strings.Builder
	b.WriteString("docker")
	for _, arg := range args {
		b.WriteByte(' ')
		b.WriteString(shellutil.HardQuote(arg))
	}
	return b.String()
}

func parseDockerContainerSummaries(output string) ([]wshrpc.DockerContainerSummary, error) {
	lines := splitNonEmptyLines(output)
	containers := make([]wshrpc.DockerContainerSummary, 0, len(lines))
	for _, line := range lines {
		parts := strings.SplitN(line, dockerFieldSep, 6)
		if len(parts) != 6 {
			return nil, fmt.Errorf("unexpected docker container row: %q", line)
		}
		containers = append(containers, wshrpc.DockerContainerSummary{
			Id:         strings.TrimSpace(parts[0]),
			Name:       strings.TrimSpace(parts[1]),
			Image:      strings.TrimSpace(parts[2]),
			State:      normalizeDockerContainerState(parts[3]),
			StatusText: strings.TrimSpace(parts[4]),
			PortsText:  strings.TrimSpace(parts[5]),
		})
	}
	return containers, nil
}

func parseDockerImageSummaries(output string) ([]wshrpc.DockerImageSummary, error) {
	lines := splitNonEmptyLines(output)
	images := make([]wshrpc.DockerImageSummary, 0, len(lines))
	for _, line := range lines {
		parts := strings.SplitN(line, dockerFieldSep, 5)
		if len(parts) != 5 {
			return nil, fmt.Errorf("unexpected docker image row: %q", line)
		}
		images = append(images, wshrpc.DockerImageSummary{
			Id:         strings.TrimSpace(parts[0]),
			Repository: strings.TrimSpace(parts[1]),
			Tag:        strings.TrimSpace(parts[2]),
			SizeText:   strings.TrimSpace(parts[3]),
			InUse:      parseDockerImageInUse(parts[4]),
		})
	}
	return images, nil
}

func splitNonEmptyLines(output string) []string {
	lines := strings.Split(strings.ReplaceAll(output, "\r\n", "\n"), "\n")
	var rtn []string
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		rtn = append(rtn, line)
	}
	return rtn
}

func normalizeDockerContainerState(raw string) string {
	state := strings.ToLower(strings.TrimSpace(raw))
	switch state {
	case "running", "paused", "exited", "created", "dead", "restarting":
		return state
	default:
		return state
	}
}

func parseDockerImageInUse(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || strings.EqualFold(trimmed, "n/a") || trimmed == "0" {
		return false
	}
	count, err := strconv.Atoi(trimmed)
	if err != nil {
		return true
	}
	return count > 0
}

func makeDockerError(err error, stdout string, stderr string) *wshrpc.DockerError {
	detail := strings.TrimSpace(stderr)
	if detail == "" {
		detail = strings.TrimSpace(stdout)
	}
	if detail == "" && err != nil {
		detail = err.Error()
	}
	lowerDetail := strings.ToLower(detail)
	switch {
	case errors.Is(err, exec.ErrNotFound),
		strings.Contains(lowerDetail, "executable file not found"),
		strings.Contains(lowerDetail, "docker: command not found"),
		strings.Contains(lowerDetail, "'docker' is not recognized"):
		return &wshrpc.DockerError{
			Code:    "missing_cli",
			Message: "Docker CLI is not available on this connection.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "cannot connect to the docker daemon"),
		strings.Contains(lowerDetail, "is the docker daemon running"),
		strings.Contains(lowerDetail, "error during connect"),
		strings.Contains(lowerDetail, "docker daemon is not running"):
		return &wshrpc.DockerError{
			Code:    "daemon_unreachable",
			Message: "Docker daemon is not reachable on this connection.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "permission denied"):
		return &wshrpc.DockerError{
			Code:    "permission_denied",
			Message: "Permission denied while accessing Docker on this connection.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "no such container"),
		strings.Contains(lowerDetail, "no such image"),
		strings.Contains(lowerDetail, "no such object"),
		strings.Contains(lowerDetail, "not found"):
		return &wshrpc.DockerError{
			Code:    "not_found",
			Message: "The requested Docker resource was not found.",
			Detail:  detail,
		}
	case strings.Contains(lowerDetail, "conflict"),
		strings.Contains(lowerDetail, "is being used by running container"),
		strings.Contains(lowerDetail, "container is running"),
		strings.Contains(lowerDetail, "must be forced"):
		return &wshrpc.DockerError{
			Code:    "conflict",
			Message: "Docker rejected the request because the resource is still in use.",
			Detail:  detail,
		}
	default:
		return &wshrpc.DockerError{
			Code:    "unknown",
			Message: "Docker command failed.",
			Detail:  detail,
		}
	}
}
