// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package clientservice

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/genconn"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/syncbuf"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
)

const SSHUploadMaxChunkSize = 4 * 1024 * 1024

type sshUploadSession struct {
	UploadID   string
	ConnName   string
	TargetPath string
	Proc       genconn.ShellProcessController
	Stdin      io.WriteCloser
	StderrBuf  *syncbuf.SyncBuffer

	lock   sync.Mutex
	closed bool
}

var (
	sshUploadSessionLock sync.Mutex
	sshUploadSessions    = make(map[string]*sshUploadSession)
)

func storeSSHUploadSession(session *sshUploadSession) {
	sshUploadSessionLock.Lock()
	defer sshUploadSessionLock.Unlock()
	sshUploadSessions[session.UploadID] = session
}

func getSSHUploadSession(uploadID string) (*sshUploadSession, error) {
	sshUploadSessionLock.Lock()
	defer sshUploadSessionLock.Unlock()
	session := sshUploadSessions[uploadID]
	if session == nil {
		return nil, fmt.Errorf("upload session not found: %s", uploadID)
	}
	return session, nil
}

func popSSHUploadSession(uploadID string) (*sshUploadSession, error) {
	sshUploadSessionLock.Lock()
	defer sshUploadSessionLock.Unlock()
	session := sshUploadSessions[uploadID]
	if session == nil {
		return nil, fmt.Errorf("upload session not found: %s", uploadID)
	}
	delete(sshUploadSessions, uploadID)
	return session, nil
}

func buildSSHUploadCommand(targetPath string, overwrite bool) string {
	quotedPath := shellutil.HardQuote(targetPath)
	overwriteCheck := ""
	if !overwrite {
		overwriteCheck = "if [ -e \"$dest\" ]; then echo \"destination already exists\" >&2; exit 1; fi;"
	}
	return fmt.Sprintf(
		"set -e; "+
			"dest=%s; "+
			"tmp=\"${dest}.waveterm-upload.$$\"; "+
			"if [ -d \"$dest\" ]; then echo \"destination is a directory\" >&2; exit 1; fi; "+
			"%s "+
			"mkdir -p \"$(dirname \"$dest\")\"; "+
			"trap 'rm -f \"$tmp\"' INT TERM EXIT; "+
			"cat > \"$tmp\"; "+
			"mv -f \"$tmp\" \"$dest\"; "+
			"trap - INT TERM EXIT",
		quotedPath,
		overwriteCheck,
	)
}

func (cs *ClientService) StartSSHUpload(ctx context.Context, connName string, targetPath string, overwrite bool) (string, error) {
	connName = strings.TrimSpace(connName)
	targetPath = strings.TrimSpace(targetPath)
	if connName == "" {
		return "", fmt.Errorf("connection is required")
	}
	if targetPath == "" {
		return "", fmt.Errorf("target path is required")
	}
	if conncontroller.IsLocalConnName(connName) {
		return "", fmt.Errorf("ssh upload does not support local connection")
	}
	if conncontroller.IsWslConnName(connName) {
		return "", fmt.Errorf("ssh upload does not support wsl connection")
	}

	if err := conncontroller.EnsureConnection(ctx, connName); err != nil {
		return "", fmt.Errorf("cannot ensure connection %q: %w", connName, err)
	}
	connOpts, err := remote.ParseOpts(connName)
	if err != nil {
		return "", fmt.Errorf("cannot parse connection name %q: %w", connName, err)
	}
	conn := conncontroller.GetConn(connOpts)
	if conn == nil {
		return "", fmt.Errorf("connection not found: %s", connName)
	}
	client := conn.GetClient()
	if client == nil {
		return "", fmt.Errorf("ssh client is not connected: %s", connName)
	}

	proc, err := genconn.MakeSSHCmdClient(client, genconn.CommandSpec{
		Cmd: buildSSHUploadCommand(targetPath, overwrite),
	})
	if err != nil {
		return "", fmt.Errorf("cannot create ssh upload process: %w", err)
	}
	stdin, err := proc.StdinPipe()
	if err != nil {
		return "", fmt.Errorf("cannot open ssh upload stdin: %w", err)
	}
	stderrBuf, err := genconn.MakeStderrSyncBuffer(proc)
	if err != nil {
		return "", fmt.Errorf("cannot open ssh upload stderr: %w", err)
	}
	if err := proc.Start(); err != nil {
		return "", fmt.Errorf("cannot start ssh upload process: %w", err)
	}

	uploadID, err := utilfn.RandomHexString(24)
	if err != nil {
		_ = stdin.Close()
		proc.Kill()
		return "", fmt.Errorf("cannot create upload session id: %w", err)
	}

	storeSSHUploadSession(&sshUploadSession{
		UploadID:   uploadID,
		ConnName:   connName,
		TargetPath: targetPath,
		Proc:       proc,
		Stdin:      stdin,
		StderrBuf:  stderrBuf,
	})
	return uploadID, nil
}

func (cs *ClientService) AppendSSHUpload(ctx context.Context, uploadID string, data64 string) error {
	if strings.TrimSpace(uploadID) == "" {
		return fmt.Errorf("upload id is required")
	}
	decodedLen := base64.StdEncoding.DecodedLen(len(data64))
	if decodedLen > SSHUploadMaxChunkSize {
		return fmt.Errorf("upload chunk exceeds max size (%d bytes)", SSHUploadMaxChunkSize)
	}
	decoded, err := base64.StdEncoding.DecodeString(data64)
	if err != nil {
		return fmt.Errorf("cannot decode upload chunk: %w", err)
	}
	session, err := getSSHUploadSession(uploadID)
	if err != nil {
		return err
	}
	session.lock.Lock()
	defer session.lock.Unlock()
	if session.closed {
		return fmt.Errorf("upload session is already closed: %s", uploadID)
	}
	if len(decoded) == 0 {
		return nil
	}
	_, err = session.Stdin.Write(decoded)
	if err != nil {
		return fmt.Errorf("error writing upload chunk to ssh stdin: %w", err)
	}
	return nil
}

func (cs *ClientService) FinishSSHUpload(ctx context.Context, uploadID string, cancel bool) error {
	if strings.TrimSpace(uploadID) == "" {
		return fmt.Errorf("upload id is required")
	}
	session, err := popSSHUploadSession(uploadID)
	if err != nil {
		return err
	}
	session.lock.Lock()
	if session.closed {
		session.lock.Unlock()
		return nil
	}
	session.closed = true
	stdin := session.Stdin
	proc := session.Proc
	stderrBuf := session.StderrBuf
	connName := session.ConnName
	targetPath := session.TargetPath
	session.lock.Unlock()

	_ = stdin.Close()
	if cancel {
		proc.Kill()
		return nil
	}

	waitErr := genconn.ProcessContextWait(ctx, proc)
	if waitErr != nil {
		stderrText := strings.TrimSpace(stderrBuf.String())
		if stderrText != "" {
			return fmt.Errorf("ssh upload failed for %s:%s: %w (stderr: %s)", connName, targetPath, waitErr, stderrText)
		}
		return fmt.Errorf("ssh upload failed for %s:%s: %w", connName, targetPath, waitErr)
	}
	return nil
}
