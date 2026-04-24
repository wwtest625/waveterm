// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveapputil

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

func ResolveGoFmtPath() (string, error) {
	gofmtName := "gofmt"
	if runtime.GOOS == "windows" {
		gofmtName = "gofmt.exe"
	}

	gofmtPath, err := exec.LookPath(gofmtName)
	if err != nil {
		return "", fmt.Errorf("gofmt not found in PATH: %w", err)
	}

	info, err := os.Stat(gofmtPath)
	if err != nil {
		return "", fmt.Errorf("gofmt not found at %s: %w", gofmtPath, err)
	}

	if info.IsDir() {
		return "", fmt.Errorf("gofmt path is a directory: %s", gofmtPath)
	}

	if info.Mode()&0111 == 0 {
		return "", fmt.Errorf("gofmt is not executable: %s", gofmtPath)
	}

	return gofmtPath, nil
}

func FormatGoCode(contents []byte) []byte {
	gofmtPath, err := ResolveGoFmtPath()
	if err != nil {
		return contents
	}

	cmd := exec.Command(gofmtPath)
	cmd.Stdin = bytes.NewReader(contents)
	formattedOutput, err := cmd.Output()
	if err != nil {
		return contents
	}

	return formattedOutput
}
