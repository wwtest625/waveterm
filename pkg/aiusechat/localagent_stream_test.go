// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"io"
	"strings"
	"testing"
	"time"
)

func TestLocalAgentStream_EmitsIncrementalText(t *testing.T) {
	reader, writer := io.Pipe()
	streamCh := make(chan localAgentStreamChunk, 16)
	doneCh := make(chan struct{})
	closedAtCh := make(chan time.Time, 1)

	go func() {
		streamPipeToChannel(reader, "stdout", streamCh)
		close(doneCh)
	}()

	go func() {
		_, _ = writer.Write([]byte("first chunk\n"))
		time.Sleep(40 * time.Millisecond)
		_, _ = writer.Write([]byte("second chunk\n"))
		_ = writer.Close()
		closedAtCh <- time.Now()
	}()

	var firstDeltaAt time.Time
	var deltas []string
	timeout := time.After(2 * time.Second)
loop:
	for {
		select {
		case chunk := <-streamCh:
			if chunk.err != nil {
				t.Fatalf("streamPipeToChannel() error: %v", chunk.err)
			}
			if chunk.text != "" {
				if firstDeltaAt.IsZero() {
					firstDeltaAt = time.Now()
				}
				deltas = append(deltas, chunk.text)
			}
		case <-doneCh:
			break loop
		case <-timeout:
			t.Fatalf("timed out waiting for stream chunks")
		}
	}

	closedAt := <-closedAtCh
	if firstDeltaAt.IsZero() {
		t.Fatalf("expected at least one delta")
	}
	if !firstDeltaAt.Before(closedAt) {
		t.Fatalf("expected first delta before process close")
	}
	gotText := strings.Join(deltas, "")
	if gotText != "first chunk\nsecond chunk\n" {
		t.Fatalf("unexpected stream output: %q", gotText)
	}
}
