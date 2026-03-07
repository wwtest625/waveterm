// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestSanitizePromptForStdin_ValidUTF8Unchanged(t *testing.T) {
	input := "你好, wave local agent\nsecond line"
	got := sanitizePromptForStdin(input)
	if got != input {
		t.Fatalf("expected prompt to remain unchanged, got %q", got)
	}
	if !utf8.ValidString(got) {
		t.Fatalf("expected valid utf-8 output")
	}
}

func TestSanitizePromptForStdin_InvalidUTF8Converted(t *testing.T) {
	input := string([]byte{'o', 'k', ':', ' ', 0xff, ' ', 'x'})
	if utf8.ValidString(input) {
		t.Fatalf("test setup invalid: expected input to be invalid utf-8")
	}

	got := sanitizePromptForStdin(input)
	if !utf8.ValidString(got) {
		t.Fatalf("expected output to be valid utf-8")
	}
	if !strings.ContainsRune(got, '\uFFFD') {
		t.Fatalf("expected invalid byte to be replaced with replacement rune, got %q", got)
	}
}

func TestUTF8StreamDecoder_BuffersIncompleteRune(t *testing.T) {
	decoder := &utf8StreamDecoder{}
	world := []byte("世界")

	got := decoder.Decode(world[:1])
	if got != "" {
		t.Fatalf("expected no output for incomplete rune, got %q", got)
	}

	got = decoder.Decode(world[1:4])
	if got != "世" {
		t.Fatalf("expected first rune after completing bytes, got %q", got)
	}

	got = decoder.Decode(world[4:])
	if got != "界" {
		t.Fatalf("expected second rune, got %q", got)
	}
}

func TestUTF8StreamDecoder_ReplacesInvalidByte(t *testing.T) {
	decoder := &utf8StreamDecoder{}
	got := decoder.Decode([]byte{0xff, 'A'})
	if got != "\uFFFDA" {
		t.Fatalf("expected replacement rune output, got %q", got)
	}
}
