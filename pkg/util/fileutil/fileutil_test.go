package fileutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicWriteFile(t *testing.T) {
	tmpDir := t.TempDir()
	fileName := filepath.Join(tmpDir, "settings.json")

	err := AtomicWriteFile(fileName, []byte(`{"key":"value"}`), 0644)
	if err != nil {
		t.Fatalf("AtomicWriteFile failed: %v", err)
	}

	data, err := os.ReadFile(fileName)
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(data) != `{"key":"value"}` {
		t.Fatalf("unexpected file contents: %q", string(data))
	}
	if _, err := os.Stat(fileName + TempFileSuffix); !os.IsNotExist(err) {
		t.Fatalf("temporary file should not exist, stat err: %v", err)
	}
}

func TestAtomicWriteFileRenameErrorCleansTempFile(t *testing.T) {
	tmpDir := t.TempDir()
	fileName := filepath.Join(tmpDir, "settings.json")

	if err := os.Mkdir(fileName, 0755); err != nil {
		t.Fatalf("Mkdir failed: %v", err)
	}

	err := AtomicWriteFile(fileName, []byte(`{"key":"value"}`), 0644)
	if err == nil {
		t.Fatalf("AtomicWriteFile expected error")
	}
	if _, statErr := os.Stat(fileName + TempFileSuffix); !os.IsNotExist(statErr) {
		t.Fatalf("temporary file should be removed on rename error, stat err: %v", statErr)
	}
}

func TestApplyEditExactMatch(t *testing.T) {
	original := []byte("hello world\n")
	edit := EditSpec{
		OldStr: "world",
		NewStr: "waveterm",
		Desc:   "replace token",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected edit to apply, got error: %s", result.Error)
	}
	if string(modified) != "hello waveterm\n" {
		t.Fatalf("unexpected content: %q", string(modified))
	}
}

func TestApplyEditLineEndingFallbackCRLF(t *testing.T) {
	original := []byte("alpha\r\nbeta\r\ngamma\r\n")
	edit := EditSpec{
		OldStr: "beta\ngamma\n",
		NewStr: "BETA\nGAMMA\n",
		Desc:   "line ending fallback",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected edit to apply with line-ending fallback, got error: %s", result.Error)
	}
	expected := "alpha\r\nBETA\r\nGAMMA\r\n"
	if string(modified) != expected {
		t.Fatalf("unexpected content after fallback edit: got %q want %q", string(modified), expected)
	}
}

func TestApplyEditLineEndingFallbackAmbiguous(t *testing.T) {
	original := []byte("x\r\ny\r\nx\r\ny\r\n")
	edit := EditSpec{
		OldStr: "x\ny\n",
		NewStr: "z\n",
		Desc:   "ambiguous line ending fallback",
	}

	_, result := applyEdit(original, edit, 0)
	if result.Applied {
		t.Fatalf("expected edit to fail due to ambiguous fallback match")
	}
	if result.Error == "" {
		t.Fatalf("expected non-empty error for ambiguous fallback match")
	}
}
