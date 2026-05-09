package fileutil

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
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

func TestApplyEditEllipsis_SkipMiddleLines(t *testing.T) {
	original := []byte("def process(data):\n    validate(data)\n    transform(data)\n    return None\n")
	edit := EditSpec{
		OldStr: "def process(data):\n    ...\n    return None",
		NewStr: "def process(data):\n    ...\n    return data",
		Desc:   "ellipsis skip middle",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected ellipsis match to apply, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "return data") {
		t.Fatalf("expected 'return data' in result, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "validate(data)") {
		t.Fatalf("expected middle lines preserved, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "transform(data)") {
		t.Fatalf("expected middle lines preserved, got %q", string(modified))
	}
}

func TestApplyEditEllipsis_ChangeOnlyEnd(t *testing.T) {
	original := []byte("class Handler:\n    def __init__(self):\n        self.data = []\n        self.cache = {}\n    def process(self):\n        pass\n")
	edit := EditSpec{
		OldStr: "class Handler:\n    ...\n    def process(self):\n        pass",
		NewStr: "class Handler:\n    ...\n    def process(self):\n        return self.data",
		Desc:   "change last method",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected ellipsis match to apply, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "return self.data") {
		t.Fatalf("expected 'return self.data' in result, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "self.cache = {}") {
		t.Fatalf("expected middle lines preserved, got %q", string(modified))
	}
}

func TestApplyEditEllipsis_NoEllipsisNoMatch(t *testing.T) {
	original := []byte("def process(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "def process(data):\n    return None",
		NewStr: "def process(data):\n    return data",
		Desc:   "no ellipsis in old_str",
	}

	modified, ok := tryEllipsisReplace(original, edit)
	if ok {
		t.Fatalf("expected tryEllipsisReplace to return false for non-ellipsis old_str, got %q", string(modified))
	}
}

func TestApplyEditEllipsis_AnchorNotFoundFails(t *testing.T) {
	original := []byte("def process(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "def handle(data):\n    ...\n    return None",
		NewStr: "def handle(data):\n    ...\n    return data",
		Desc:   "anchor not found",
	}

	_, ok := tryEllipsisReplace(original, edit)
	if ok {
		t.Fatalf("expected ellipsis match to fail when anchor not found")
	}
}

func TestApplyEditEllipsis_MultipleEllipsis(t *testing.T) {
	original := []byte("class Handler:\n    def __init__(self):\n        self.data = []\n    def process(self):\n        pass\n    def cleanup(self):\n        pass\n")
	edit := EditSpec{
		OldStr: "class Handler:\n    ...\n    def process(self):\n        pass\n    ...\n    def cleanup(self):\n        pass",
		NewStr: "class Handler:\n    ...\n    def process(self):\n        return self.data\n    ...\n    def cleanup(self):\n        del self.data",
		Desc:   "multiple ellipsis",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected multi-ellipsis match to apply, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "return self.data") {
		t.Fatalf("expected 'return self.data' in result, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "del self.data") {
		t.Fatalf("expected 'del self.data' in result, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "self.data = []") {
		t.Fatalf("expected __init__ preserved, got %q", string(modified))
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

func TestApplyEditWhitespaceTolerance_ModelWrites2SpacesFileHas4(t *testing.T) {
	original := []byte("class Handler:\n    def process(data):\n        return None\n")
	edit := EditSpec{
		OldStr: "def process(data):\n    return None",
		NewStr: "def process(data):\n    return data",
		Desc:   "fix return value",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected whitespace-tolerant edit to apply, got error: %s", result.Error)
	}
	expected := "class Handler:\n    def process(data):\n        return data\n"
	if string(modified) != expected {
		t.Fatalf("unexpected content: got %q want %q", string(modified), expected)
	}
}

func TestApplyEditWhitespaceTolerance_MultiLineBlock(t *testing.T) {
	original := []byte("class Handler:\n    def process(self, data):\n        result = self.transform(data)\n        return result\n")
	edit := EditSpec{
		OldStr: "def process(self, data):\n        result = self.transform(data)\n        return result",
		NewStr: "def process(self, data):\n        result = self.transform(data)\n        return result\n    def transform(self, data):\n        return data.upper()",
		Desc:   "add transform method",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected whitespace-tolerant edit to apply, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "def transform(self, data):") {
		t.Fatalf("expected new method in content, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "    def process(self, data):") {
		t.Fatalf("expected original method with correct indent, got %q", string(modified))
	}
}

func TestApplyEditWhitespaceTolerance_CRLFFile(t *testing.T) {
	original := []byte("class Handler:\r\n    def process(data):\r\n        return None\r\n")
	edit := EditSpec{
		OldStr: "def process(data):\n    return None",
		NewStr: "def process(data):\n    return data",
		Desc:   "fix return value with CRLF",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected whitespace-tolerant edit to apply on CRLF file, got error: %s", result.Error)
	}
	if !bytes.Contains(modified, []byte("\r\n")) {
		t.Fatalf("expected CRLF line endings preserved, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "        return data") {
		t.Fatalf("expected correct indentation in result, got %q", string(modified))
	}
}

func TestApplyEditWhitespaceTolerance_AmbiguousMatchFails(t *testing.T) {
	original := []byte("def process(data):\n    return None\n\ndef handle(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "return None",
		NewStr: "return data",
		Desc:   "ambiguous single-line match",
	}

	_, result := applyEdit(original, edit, 0)
	if result.Applied {
		t.Fatalf("expected ambiguous whitespace-tolerant match to fail")
	}
}

func TestApplyEditWhitespaceTolerance_NoMatchAtAll(t *testing.T) {
	original := []byte("def process(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "def handle(data):\n  return None",
		NewStr: "def handle(data):\n  return data",
		Desc:   "non-matching content",
	}

	_, result := applyEdit(original, edit, 0)
	if result.Applied {
		t.Fatalf("expected non-matching edit to fail")
	}
	if !strings.Contains(result.Error, "old_str not found in file") {
		t.Fatalf("expected not-found error, got: %s", result.Error)
	}
}

func TestApplyEditDidYouMeanHint(t *testing.T) {
	original := []byte("def process(data):\n    result = transform(data)\n    return result\n")
	edit := EditSpec{
		OldStr: "def process(data):\n    return Nil",
		NewStr: "def process(data):\n    return data",
		Desc:   "content too different for fuzzy match",
	}

	_, result := applyEdit(original, edit, 0)
	if result.Applied {
		t.Fatalf("expected edit with very different content to fail")
	}
	if !strings.Contains(result.Error, "Did you mean") {
		t.Fatalf("expected 'Did you mean' hint in error, got: %s", result.Error)
	}
}

func TestApplyEditExactMatchStillWorks(t *testing.T) {
	original := []byte("hello world\n")
	edit := EditSpec{
		OldStr: "world",
		NewStr: "waveterm",
		Desc:   "exact match still works",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected exact match to still work, got error: %s", result.Error)
	}
	if string(modified) != "hello waveterm\n" {
		t.Fatalf("unexpected content: %q", string(modified))
	}
}

func TestApplyEditWhitespaceTolerance_ModelWritesNoIndentFileHas4(t *testing.T) {
	original := []byte("def process(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "return None",
		NewStr: "return data",
		Desc:   "no indent in old_str",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected whitespace-tolerant edit to apply, got error: %s", result.Error)
	}
	expected := "def process(data):\n    return data\n"
	if string(modified) != expected {
		t.Fatalf("unexpected content: got %q want %q", string(modified), expected)
	}
}

func TestApplyEditWhitespaceTolerance_PreservesRelativeIndentation(t *testing.T) {
	original := []byte("class Handler:\n    def process(self):\n        pass\n")
	edit := EditSpec{
		OldStr: "def process(self):\n        pass",
		NewStr: "def process(self):\n        result = self.run()\n        return result",
		Desc:   "expand method body",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected whitespace-tolerant edit to apply, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "        result = self.run()") {
		t.Fatalf("expected correct 8-space indent for method body, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "    def process(self):") {
		t.Fatalf("expected correct 4-space indent for method def, got %q", string(modified))
	}
}

func TestApplyEditFuzzyMatch_DifferentIndentScale(t *testing.T) {
	original := []byte("def process(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "def process(data):\n  return None",
		NewStr: "def process(data):\n  return data",
		Desc:   "2-space vs 4-space body indent",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected fuzzy match to apply, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "return data") {
		t.Fatalf("expected replacement in content, got %q", string(modified))
	}
}

func TestApplyEditFuzzyMatch_SmallTypo(t *testing.T) {
	original := []byte("def process(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "def procses(data):\n    return None",
		NewStr: "def process(data):\n    return data",
		Desc:   "typo in function name",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected fuzzy match to apply despite typo, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "return data") {
		t.Fatalf("expected replacement in content, got %q", string(modified))
	}
}

func TestApplyEditFuzzyMatch_TooDifferentFails(t *testing.T) {
	original := []byte("def process(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "class Handler:\n    def run(self):\n        pass",
		NewStr: "class Handler:\n    def run(self):\n        return True",
		Desc:   "completely different content",
	}

	_, result := applyEdit(original, edit, 0)
	if result.Applied {
		t.Fatalf("expected fuzzy match to fail for completely different content")
	}
}

func TestApplyEditFuzzyMatch_AmbiguousFails(t *testing.T) {
	original := []byte("def process(data):\n    return None\n\ndef process(items):\n    return None\n")
	edit := EditSpec{
		OldStr: "def process(xxx):\n  return Nil",
		NewStr: "def process(xxx):\n  return data",
		Desc:   "ambiguous fuzzy match",
	}

	_, result := applyEdit(original, edit, 0)
	if result.Applied {
		t.Fatalf("expected ambiguous fuzzy match to fail")
	}
}

func TestComputeLineScore_PerfectMatch(t *testing.T) {
	window := []string{"def foo():", "    pass"}
	old := []string{"def foo():", "    pass"}
	score := computeLineScore(window, old)
	if score != 1.0 {
		t.Fatalf("expected score 1.0, got %f", score)
	}
}

func TestComputeLineScore_TrimSpaceMatch(t *testing.T) {
	window := []string{"def foo():", "        pass"}
	old := []string{"def foo():", "  pass"}
	score := computeLineScore(window, old)
	if score != 1.0 {
		t.Fatalf("expected score 1.0 for TrimSpace match, got %f", score)
	}
}

func TestComputeLineScore_PartialMatch(t *testing.T) {
	window := []string{"def foo():", "    return data"}
	old := []string{"def foo():", "    return deta"}
	score := computeLineScore(window, old)
	if score < 0.7 || score >= 1.0 {
		t.Fatalf("expected score between 0.7 and 1.0 for partial match, got %f", score)
	}
}

func TestComputeLineScore_TooDifferentLineGivesZero(t *testing.T) {
	window := []string{"def foo():", "    pass"}
	old := []string{"def foo():", "    return"}
	score := computeLineScore(window, old)
	if score != 0 {
		t.Fatalf("expected score 0 when a line is too different, got %f", score)
	}
}

func TestApplyEditsPartial_ChainAwarenessHint(t *testing.T) {
	original := []byte("hello = 1\nworld = 2\nfoo = 3\n")
	edits := []EditSpec{
		{OldStr: "hello = 1", NewStr: "greeting = 1", Desc: "rename variable"},
		{OldStr: "hello = 1\nworld = 2", NewStr: "hello = 1\nworld = 20", Desc: "change world (stale old_str)"},
	}

	_, results := ApplyEditsPartial(original, edits)
	if results[0].Applied != true {
		t.Fatalf("expected first edit to apply")
	}
	if results[1].Applied {
		t.Fatalf("expected second edit to fail (stale old_str)")
	}
	if !strings.Contains(results[1].Error, "previous edit") {
		t.Fatalf("expected chain awareness hint in error, got: %s", results[1].Error)
	}
}

func TestApplyEditsPartial_NoHintOnFirstEdit(t *testing.T) {
	original := []byte("x = 1\n")
	edits := []EditSpec{
		{OldStr: "y = 2", NewStr: "y = 20", Desc: "non-matching first edit"},
	}

	_, results := ApplyEditsPartial(original, edits)
	if results[0].Applied {
		t.Fatalf("expected first edit to fail")
	}
	if strings.Contains(results[0].Error, "previous edit") {
		t.Fatalf("expected no chain awareness hint for first edit, got: %s", results[0].Error)
	}
}

func TestApplyEditEllipsis_CRLFFile(t *testing.T) {
	original := []byte("def process(data):\r\n    validate(data)\r\n    return None\r\n")
	edit := EditSpec{
		OldStr: "def process(data):\n    ...\n    return None",
		NewStr: "def process(data):\n    ...\n    return data",
		Desc:   "ellipsis with CRLF",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected ellipsis match to apply on CRLF file, got error: %s", result.Error)
	}
	if !bytes.Contains(modified, []byte("\r\n")) {
		t.Fatalf("expected CRLF line endings preserved, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "return data") {
		t.Fatalf("expected 'return data' in result, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "validate(data)") {
		t.Fatalf("expected middle lines preserved, got %q", string(modified))
	}
}

func TestApplyEditFuzzyMatch_CRLFFile(t *testing.T) {
	original := []byte("def process(data):\r\n    return None\r\n")
	edit := EditSpec{
		OldStr: "def process(data):\n  return None",
		NewStr: "def process(data):\n  return data",
		Desc:   "fuzzy match with CRLF",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected fuzzy match to apply on CRLF file, got error: %s", result.Error)
	}
	if !bytes.Contains(modified, []byte("\r\n")) {
		t.Fatalf("expected CRLF line endings preserved, got %q", string(modified))
	}
	if !strings.Contains(string(modified), "return data") {
		t.Fatalf("expected replacement in content, got %q", string(modified))
	}
}

func TestApplyEditFuzzyMatch_MiddleCharTypo(t *testing.T) {
	original := []byte("def process(data):\n    return None\n")
	edit := EditSpec{
		OldStr: "def porcess(data):\n    return None",
		NewStr: "def process(data):\n    return data",
		Desc:   "middle character swap",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected fuzzy match to apply despite middle char typo, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "return data") {
		t.Fatalf("expected replacement in content, got %q", string(modified))
	}
}

func TestApplyEditSingleLineFile(t *testing.T) {
	original := []byte("hello world\n")
	edit := EditSpec{
		OldStr: "hello wrld",
		NewStr: "hello waveterm",
		Desc:   "single line fuzzy",
	}

	modified, result := applyEdit(original, edit, 0)
	if !result.Applied {
		t.Fatalf("expected fuzzy match on single line file, got error: %s", result.Error)
	}
	if !strings.Contains(string(modified), "hello waveterm") {
		t.Fatalf("expected replacement in content, got %q", string(modified))
	}
}

func TestLongestCommonSubsequenceLen(t *testing.T) {
	tests := []struct {
		a, b     string
		expected int
	}{
		{"abc", "abc", 3},
		{"abc", "def", 0},
		{"abc", "afc", 2},
		{"process", "porcess", 6},
		{"", "abc", 0},
		{"abc", "", 0},
	}
	for _, tt := range tests {
		got := longestCommonSubsequenceLen(tt.a, tt.b)
		if got != tt.expected {
			t.Errorf("longestCommonSubsequenceLen(%q, %q) = %d, want %d", tt.a, tt.b, got, tt.expected)
		}
	}
}
