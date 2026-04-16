package aiusechat

import (
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestClassifyTuiCommand_Always(t *testing.T) {
	tests := []struct {
		command string
		want    TuiCategory
	}{
		{"vim file.txt", TuiCategoryAlways},
		{"vi config.yaml", TuiCategoryAlways},
		{"nano README.md", TuiCategoryAlways},
		{"emacs main.go", TuiCategoryAlways},
		{"tmux new -s dev", TuiCategoryAlways},
		{"screen -r", TuiCategoryAlways},
	}
	for _, test := range tests {
		got := classifyTuiCommand(test.command)
		if got != test.want {
			t.Errorf("classifyTuiCommand(%q) = %q, want %q", test.command, got, test.want)
		}
	}
}

func TestClassifyTuiCommand_Pager(t *testing.T) {
	tests := []struct {
		command string
		want    TuiCategory
	}{
		{"less README.md", TuiCategoryNonBlacklist},
		{"more /var/log/syslog", TuiCategoryNonBlacklist},
		{"man ls", TuiCategoryNonBlacklist},
		{"git log", TuiCategoryNonBlacklist},
		{"git diff HEAD~1", TuiCategoryNonBlacklist},
		{"journalctl -u nginx", TuiCategoryNonBlacklist},
		{"cat file | less", TuiCategoryNonBlacklist},
	}
	for _, test := range tests {
		got := classifyTuiCommand(test.command)
		if got != test.want {
			t.Errorf("classifyTuiCommand(%q) = %q, want %q", test.command, got, test.want)
		}
	}
}

func TestClassifyTuiCommand_Conditional(t *testing.T) {
	tests := []struct {
		command string
		want    TuiCategory
	}{
		{"top", TuiCategoryConditional},
		{"htop", TuiCategoryConditional},
		{"mysql -u root", TuiCategoryConditional},
		{"psql -U postgres", TuiCategoryConditional},
		{"ssh user@host", TuiCategoryConditional},
	}
	for _, test := range tests {
		got := classifyTuiCommand(test.command)
		if got != test.want {
			t.Errorf("classifyTuiCommand(%q) = %q, want %q", test.command, got, test.want)
		}
	}
}

func TestClassifyTuiCommand_ConditionalWithNonInteractiveArgs(t *testing.T) {
	tests := []struct {
		command string
		want    TuiCategory
	}{
		{"top -n 1 -b", TuiCategoryNonBlacklist},
		{"top -b", TuiCategoryNonBlacklist},
		{"mysql -u root -e 'SELECT 1'", TuiCategoryNonBlacklist},
		{"mysql --batch", TuiCategoryNonBlacklist},
		{"psql -c 'SELECT 1'", TuiCategoryNonBlacklist},
		{"ssh -T user@host", TuiCategoryNonBlacklist},
		{"ssh -o BatchMode=yes user@host", TuiCategoryNonBlacklist},
	}
	for _, test := range tests {
		got := classifyTuiCommand(test.command)
		if got != test.want {
			t.Errorf("classifyTuiCommand(%q) = %q, want %q", test.command, got, test.want)
		}
	}
}

func TestClassifyTuiCommand_NonBlacklist(t *testing.T) {
	tests := []struct {
		command string
		want    TuiCategory
	}{
		{"ls -la", TuiCategoryNonBlacklist},
		{"echo hello", TuiCategoryNonBlacklist},
		{"python script.py", TuiCategoryNonBlacklist},
		{"npm install", TuiCategoryNonBlacklist},
	}
	for _, test := range tests {
		got := classifyTuiCommand(test.command)
		if got != test.want {
			t.Errorf("classifyTuiCommand(%q) = %q, want %q", test.command, got, test.want)
		}
	}
}

func TestDetectExitKey(t *testing.T) {
	tests := []struct {
		output       string
		wantKey      string
		wantAppend   bool
	}{
		{"Press q to quit", "q", false},
		{"Press q to exit", "q", false},
		{"(q to quit)", "q", false},
		{"Type quit to exit", "quit", true},
		{"Type exit to exit", "exit", true},
		{"按 q 退出", "q", false},
		{"输入quit退出", "quit", true},
		{"No exit key here", "", false},
	}
	for _, test := range tests {
		key, append := detectExitKey(test.output)
		if key != test.wantKey || append != test.wantAppend {
			t.Errorf("detectExitKey(%q) = (%q, %v), want (%q, %v)", test.output, key, append, test.wantKey, test.wantAppend)
		}
	}
}

func TestTryQuickMatch(t *testing.T) {
	tests := []struct {
		text     string
		wantType InteractionType
		wantOk   bool
	}{
		{"Password:", InteractionPassword, true},
		{"Passphrase:", InteractionPassword, true},
		{"[sudo] password for user", InteractionPassword, true},
		{"Continue? [Y/n]", InteractionConfirm, true},
		{"[y/N]", InteractionConfirm, true},
		{"(yes/no)", InteractionConfirm, true},
		{"Press Enter to continue", InteractionEnter, true},
		{"--More--", InteractionPager, true},
		{"(END)", InteractionPager, true},
		{"No match here", "", false},
	}
	for _, test := range tests {
		result := tryQuickMatch(test.text)
		if test.wantOk {
			if result == nil {
				t.Errorf("tryQuickMatch(%q) = nil, want type %q", test.text, test.wantType)
				continue
			}
			if result.InteractionType != test.wantType {
				t.Errorf("tryQuickMatch(%q) type = %q, want %q", test.text, result.InteractionType, test.wantType)
			}
		} else {
			if result != nil {
				t.Errorf("tryQuickMatch(%q) = %+v, want nil", test.text, result)
			}
		}
	}
}

func TestTryQuickMatch_ConfirmValues(t *testing.T) {
	result := tryQuickMatch("Continue? [Y/n]")
	if result == nil {
		t.Fatal("expected result")
	}
	if result.ConfirmValues == nil {
		t.Fatal("expected confirm values")
	}
	if result.ConfirmValues.Yes != "Y" || result.ConfirmValues.No != "n" || result.ConfirmValues.Default != "Y" {
		t.Errorf("unexpected confirm values: %+v", result.ConfirmValues)
	}
	if len(result.Options) != 2 || result.Options[0] != "Y" || result.Options[1] != "n" {
		t.Errorf("unexpected options: %+v", result.Options)
	}
}

func TestInteractionDetector_DismissAndSuppress(t *testing.T) {
	detector := newInteractionDetector("vim test.txt", "job-dismiss-test")
	defer removeInteractionDetector("job-dismiss-test")

	if detector.isSuppressed {
		t.Error("should not be suppressed initially")
	}
	detector.onDismiss()
	detector.onDismiss()
	if detector.isSuppressed {
		t.Error("should not be suppressed after 2 dismisses")
	}
	detector.onDismiss()
	if !detector.isSuppressed {
		t.Error("should be suppressed after 3 dismisses")
	}
}

func TestInteractionDetector_Debounce(t *testing.T) {
	detector := newInteractionDetector("top", "job-debounce-test")
	defer removeInteractionDetector("job-debounce-test")

	if detector.isDebounced() {
		t.Error("first call should not be debounced")
	}
	if !detector.isDebounced() {
		t.Error("immediate second call should be debounced")
	}
	detector.lastPromptTime = time.Now().Add(-time.Duration(promptDebounceMs+100) * time.Millisecond)
	if detector.isDebounced() {
		t.Error("call after debounce window should not be debounced")
	}
}

func TestInteractionDetector_HashDedup(t *testing.T) {
	detector := newInteractionDetector("ls", "job-hash-test")
	defer removeInteractionDetector("job-hash-test")

	if detector.updateHash("output-a") {
		t.Error("first hash should not trigger unchanged")
	}
	detector.updateHash("output-a")
	detector.updateHash("output-a")
	if !detector.updateHash("output-a") {
		t.Error("should trigger unchanged after maxHashUnchangedCount")
	}
	if detector.updateHash("output-b") {
		t.Error("different hash should reset counter")
	}
}

func TestInteractionDetector_LLMCallLimit(t *testing.T) {
	detector := newInteractionDetector("custom", "job-llm-test")
	defer removeInteractionDetector("job-llm-test")

	for i := 0; i < maxLlmCalls; i++ {
		if !detector.canCallLLM() {
			t.Errorf("call %d should be allowed", i+1)
		}
	}
	if detector.canCallLLM() {
		t.Error("should not allow calls beyond limit")
	}
}

func TestComputeOutputHash_Stable(t *testing.T) {
	h1 := computeOutputHash("test output")
	h2 := computeOutputHash("test output")
	if h1 != h2 {
		t.Errorf("same input should produce same hash: %q vs %q", h1, h2)
	}
	h3 := computeOutputHash("different output")
	if h1 == h3 {
		t.Error("different input should produce different hash")
	}
}

func TestContainsAnySeq(t *testing.T) {
	if !containsAnySeq("\x1b[?1049h", alternateScreenEnterSeqs) {
		t.Error("should detect alternate screen enter sequence")
	}
	if containsAnySeq("normal output", alternateScreenEnterSeqs) {
		t.Error("should not detect sequence in normal output")
	}
	if !containsAnySeq("\x1b[?1049l", alternateScreenExitSeqs) {
		t.Error("should detect alternate screen exit sequence")
	}
}

func TestIsPagerOutput(t *testing.T) {
	tests := []struct {
		output string
		want   bool
	}{
		{"line1\nline2\n(END)", true},
		{"line1\n--More--", true},
		{"line1\n:", true},
		{"Normal output", false},
		{"Manual page ls(1)", true},
	}
	for _, test := range tests {
		got := isPagerOutput(test.output)
		if got != test.want {
			t.Errorf("isPagerOutput(%q) = %v, want %v", test.output, got, test.want)
		}
	}
}

func TestIsPromptExcluded(t *testing.T) {
	tests := []struct {
		text string
		want bool
	}{
		{"INFO: something happened", true},
		{"2024-01-15T10:30:00 log:", true},
		{"https://example.com:", true},
		{"Enter your password:", false},
	}
	for _, test := range tests {
		got := isPromptExcluded(test.text)
		if got != test.want {
			t.Errorf("isPromptExcluded(%q) = %v, want %v", test.text, got, test.want)
		}
	}
}

func TestHasPromptKeyword(t *testing.T) {
	tests := []struct {
		text string
		want bool
	}{
		{"Enter your password:", true},
		{"Please confirm:", true},
		{"输入验证码:", true},
		{"Just a normal line", false},
	}
	for _, test := range tests {
		got := hasPromptKeyword(test.text)
		if got != test.want {
			t.Errorf("hasPromptKeyword(%q) = %v, want %v", test.text, got, test.want)
		}
	}
}

func TestDetectInteractionByRules_FreeformWithPromptSuffix(t *testing.T) {
	output := "Processing...\nEnter your username:"
	got := detectInteractionByRules(output)
	if got == nil {
		t.Fatal("expected freeform interaction")
	}
	if got.Interaction != "freeform" {
		t.Errorf("expected freeform, got %q", got.Interaction)
	}
	if got.Source != "rules" {
		t.Errorf("expected rules source, got %q", got.Source)
	}
}

func TestDetectInteractionByRules_ExcludedLogLine(t *testing.T) {
	output := "INFO: processing complete"
	got := detectInteractionByRules(output)
	if got != nil {
		t.Errorf("expected nil for excluded log line, got %+v", got)
	}
}

func TestDetectInteractionByRules_AnsiStripped(t *testing.T) {
	output := "\x1b[32mPassword:\x1b[0m"
	got := detectInteractionByRules(output)
	if got == nil {
		t.Fatal("expected password detection after ANSI stripping")
	}
	if got.Interaction != "password" {
		t.Errorf("expected password, got %q", got.Interaction)
	}
}

func TestDetectInteractionByRules_ExitKeyOnPager(t *testing.T) {
	output := "line1\nline2\nPress q to quit"
	got := detectInteractionByRules(output)
	if got == nil {
		t.Fatal("expected pager interaction")
	}
	if got.ExitKey != "q" {
		t.Errorf("expected exit key q, got %q", got.ExitKey)
	}
}

func TestDetectInteractionByRules_QuickMatchConfirmWithExitKey(t *testing.T) {
	output := "Do you want to continue? [Y/n]"
	got := detectInteractionByRules(output)
	if got == nil {
		t.Fatal("expected interaction")
	}
	if got.Interaction != "confirm" {
		t.Errorf("expected confirm, got %q", got.Interaction)
	}
	if got.ConfirmValues == nil || got.ConfirmValues.Yes != "Y" {
		t.Errorf("expected confirm values with Yes=Y, got %+v", got.ConfirmValues)
	}
}

func TestDetectCommandInteraction_SnapshotPriority(t *testing.T) {
	snapshot := &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:         "job-snap-priority",
		Status:        "running",
		Output:        "Password:",
		AwaitingInput: true,
		PromptHint:    "Enter your token",
		InputOptions:  []string{"123456"},
	}
	got := detectCommandInteraction("git clone https://x", snapshot)
	if got == nil {
		t.Fatal("expected interaction")
	}
	if got.Source != "snapshot" {
		t.Errorf("expected snapshot source, got %q", got.Source)
	}
	if got.PromptHint != "Enter your token" {
		t.Errorf("unexpected prompt hint: %q", got.PromptHint)
	}
}

func TestDetectCommandInteraction_RulesFallback(t *testing.T) {
	snapshot := &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:  "job-rules-fallback",
		Status: "running",
		Output: "Password:",
	}
	got := detectCommandInteraction("sudo apt install", snapshot)
	if got == nil {
		t.Fatal("expected interaction")
	}
	if got.Source != "rules" {
		t.Errorf("expected rules source, got %q", got.Source)
	}
	if got.Interaction != "password" {
		t.Errorf("expected password, got %q", got.Interaction)
	}
}

func TestDetectCommandInteraction_LLMFallback(t *testing.T) {
	originalLLM := interactionDetectorLLM
	defer func() { interactionDetectorLLM = originalLLM }()

	llmCalls := 0
	interactionDetectorLLM = func(input interactionLLMInput) (*detectedInteraction, error) {
		llmCalls++
		return &detectedInteraction{
			AwaitingInput: true,
			PromptHint:    "LLM detected prompt",
			Interaction:   "freeform",
			Source:        "llm",
		}, nil
	}

	newInteractionDetector("custom-cli run", "job-llm-fallback")
	defer removeInteractionDetector("job-llm-fallback")

	snapshot := &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:  "job-llm-fallback",
		Status: "running",
		Output: "Continue with deployment?",
	}
	got := detectCommandInteraction("custom-cli run", snapshot)
	if got == nil {
		t.Fatal("expected LLM detection result")
	}
	if got.Source != "llm" {
		t.Errorf("expected llm source, got %q", got.Source)
	}
	if llmCalls != 1 {
		t.Errorf("expected exactly one llm call, got %d", llmCalls)
	}
}

func TestDetectCommandInteraction_LLMNotCalledWhenRulesMatch(t *testing.T) {
	originalLLM := interactionDetectorLLM
	defer func() { interactionDetectorLLM = originalLLM }()

	llmCalls := 0
	interactionDetectorLLM = func(input interactionLLMInput) (*detectedInteraction, error) {
		llmCalls++
		return &detectedInteraction{AwaitingInput: true, Interaction: "freeform", Source: "llm"}, nil
	}

	snapshot := &wshrpc.CommandAgentGetCommandResultRtnData{
		JobId:  "job-no-llm",
		Status: "running",
		Output: "Password:",
	}
	got := detectCommandInteraction("sudo something", snapshot)
	if got == nil || got.Interaction != "password" {
		t.Fatalf("expected rule-based password detection, got %+v", got)
	}
	if llmCalls != 0 {
		t.Errorf("expected no llm calls when rules match, got %d", llmCalls)
	}
}

func TestNormalizeInteractionOutput_CRProgress(t *testing.T) {
	output := "downloading 50%\rdownloading 75%\rdownloading 100%\nDone"
	normalized := normalizeInteractionOutput(output)
	if normalized != "downloading 100%\nDone" {
		t.Errorf("expected CR progress handling, got %q", normalized)
	}
}

func TestMakeInteractionDedupKey_Consistency(t *testing.T) {
	a := &detectedInteraction{
		AwaitingInput: true,
		PromptHint:    "Enter password:",
		InputOptions:  []string{"a", "b"},
		Interaction:   "password",
	}
	b := &detectedInteraction{
		AwaitingInput: true,
		PromptHint:    "enter password:",
		InputOptions:  []string{"a", "b"},
		Interaction:   "password",
	}
	keyA := makeInteractionDedupKey(a)
	keyB := makeInteractionDedupKey(b)
	if keyA != keyB {
		t.Errorf("case-insensitive dedup keys should match: %q vs %q", keyA, keyB)
	}
}

func TestMakeInteractionDedupKey_TuiDifference(t *testing.T) {
	a := &detectedInteraction{
		AwaitingInput: true,
		PromptHint:    "prompt",
		Interaction:   "tui",
		TuiDetected:   true,
	}
	b := &detectedInteraction{
		AwaitingInput: true,
		PromptHint:    "prompt",
		Interaction:   "tui",
		TuiDetected:   false,
	}
	keyA := makeInteractionDedupKey(a)
	keyB := makeInteractionDedupKey(b)
	if keyA == keyB {
		t.Errorf("TUI-detected difference should produce different keys")
	}
}

func TestDetectorRegistry_Lifecycle(t *testing.T) {
	newInteractionDetector("vim test.txt", "job-lifecycle")
	if got := getInteractionDetector("job-lifecycle"); got == nil || got.commandId != "job-lifecycle" {
		t.Error("detector should be registered")
	}
	removeInteractionDetector("job-lifecycle")
	if got := getInteractionDetector("job-lifecycle"); got != nil {
		t.Error("detector should be removed")
	}
}

func TestShouldTriggerInteractionLLMFallback_Conditions(t *testing.T) {
	originalLLM := interactionDetectorLLM
	defer func() { interactionDetectorLLM = originalLLM }()
	interactionDetectorLLM = func(input interactionLLMInput) (*detectedInteraction, error) {
		return nil, nil
	}

	if shouldTriggerInteractionLLMFallback("", "", nil) {
		t.Error("should not trigger with nil snapshot")
	}
	if shouldTriggerInteractionLLMFallback("cmd", "output", &wshrpc.CommandAgentGetCommandResultRtnData{Status: "completed"}) {
		t.Error("should not trigger with non-running status")
	}
	if shouldTriggerInteractionLLMFallback("cmd", "", &wshrpc.CommandAgentGetCommandResultRtnData{Status: "running"}) {
		t.Error("should not trigger with empty output")
	}
	if shouldTriggerInteractionLLMFallback("cmd", "no prompt pattern here", &wshrpc.CommandAgentGetCommandResultRtnData{Status: "running"}) {
		t.Error("should not trigger without LLM candidate pattern")
	}
	if !shouldTriggerInteractionLLMFallback("cmd", "Enter value:", &wshrpc.CommandAgentGetCommandResultRtnData{Status: "running"}) {
		t.Error("should trigger with matching pattern and running status")
	}
}
