// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"regexp"
	"strings"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type detectedInteraction struct {
	AwaitingInput bool
	PromptHint    string
	InputOptions  []string
	TuiDetected   bool
	TuiSuppressed bool
	Interaction   string
	ExitKey       string
	Source        string
	DedupKey      string
}

type interactionLLMInput struct {
	Command string
	Output  string
}

type interactionLLMAnalyzer func(interactionLLMInput) (*detectedInteraction, error)

var interactionDetectorLLM interactionLLMAnalyzer

var ansiEscapePattern = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
var passwordPromptPattern = regexp.MustCompile(`(?i)(password|passphrase|验证码|密码)\s*[:：]\s*$`)
var confirmPromptPattern = regexp.MustCompile(`(?i)(\[y/n\]|\[y/N\]|\[Y/n\]|\(yes/no\)|\bconfirm\b|\bcontinue\?\b|是否继续|确认继续)`)
var selectPromptPattern = regexp.MustCompile(`(?i)(select|choose|choice|enter\s+number|请输入编号|请选择|输入序号)`)
var enterPromptPattern = regexp.MustCompile(`(?i)(press\s+enter|press\s+any\s+key|hit\s+enter|按回车|按任意键)`)
var pagerPromptPattern = regexp.MustCompile(`(?i)(--more--|\(END\)|^:\s*$|press\s+q\s+to\s+quit|按\s*q\s*退出)`)
var llmFallbackCandidatePattern = regexp.MustCompile(`(?i)([:：]\s*$|\?\s*$|input|enter|choose|select|token|otp|verification|login|username|password|passphrase)`)

func normalizeInteractionOutput(output string) string {
	if output == "" {
		return ""
	}
	noAnsi := ansiEscapePattern.ReplaceAllString(output, "")
	normalizedCRLF := strings.ReplaceAll(noAnsi, "\r\n", "\n")
	lines := strings.Split(normalizedCRLF, "\n")
	for i, line := range lines {
		if strings.Contains(line, "\r") {
			segments := strings.Split(line, "\r")
			lines[i] = segments[len(segments)-1]
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func tailLines(input string, maxLines int) string {
	if maxLines <= 0 {
		return strings.TrimSpace(input)
	}
	lines := strings.Split(strings.TrimSpace(input), "\n")
	if len(lines) <= maxLines {
		return strings.Join(lines, "\n")
	}
	return strings.Join(lines[len(lines)-maxLines:], "\n")
}

func normalizeInputOptions(options []string) []string {
	if len(options) == 0 {
		return nil
	}
	rtn := make([]string, 0, len(options))
	for _, option := range options {
		trimmed := strings.TrimSpace(option)
		if trimmed == "" {
			continue
		}
		rtn = append(rtn, trimmed)
	}
	if len(rtn) == 0 {
		return nil
	}
	return rtn
}

func makeInteractionDedupKey(interaction *detectedInteraction) string {
	if interaction == nil {
		return ""
	}
	parts := []string{
		strings.TrimSpace(interaction.Interaction),
		strings.TrimSpace(strings.ToLower(interaction.PromptHint)),
		strings.Join(interaction.InputOptions, "|"),
	}
	if interaction.TuiDetected {
		parts = append(parts, "tui")
	}
	if interaction.TuiSuppressed {
		parts = append(parts, "suppressed")
	}
	return strings.Join(parts, "::")
}

func normalizeDetectedInteraction(interaction *detectedInteraction) *detectedInteraction {
	if interaction == nil {
		return nil
	}
	cloned := *interaction
	cloned.PromptHint = strings.TrimSpace(cloned.PromptHint)
	cloned.InputOptions = normalizeInputOptions(cloned.InputOptions)
	if !cloned.AwaitingInput && !cloned.TuiDetected {
		return nil
	}
	cloned.DedupKey = makeInteractionDedupKey(&cloned)
	return &cloned
}

func interactionFromSnapshot(snapshot *wshrpc.CommandAgentGetCommandResultRtnData) *detectedInteraction {
	if snapshot == nil {
		return nil
	}
	interaction := &detectedInteraction{
		AwaitingInput: snapshot.AwaitingInput,
		PromptHint:    strings.TrimSpace(snapshot.PromptHint),
		InputOptions:  normalizeInputOptions(snapshot.InputOptions),
		TuiDetected:   snapshot.TuiDetected,
		TuiSuppressed: snapshot.TuiSuppressed,
		Source:        "snapshot",
	}
	if interaction.TuiDetected {
		interaction.Interaction = "tui"
	}
	if interaction.AwaitingInput && interaction.Interaction == "" {
		interaction.Interaction = "input"
	}
	if interaction.PromptHint == "" && interaction.TuiDetected {
		interaction.PromptHint = "Interactive TUI detected"
	}
	return normalizeDetectedInteraction(interaction)
}

func detectInteractionByRules(output string) *detectedInteraction {
	normalized := normalizeInteractionOutput(output)
	if normalized == "" {
		return nil
	}
	window := tailLines(normalized, 20)
	lastLine := tailLines(window, 1)
	switch {
	case pagerPromptPattern.MatchString(lastLine):
		return normalizeDetectedInteraction(&detectedInteraction{
			AwaitingInput: true,
			PromptHint:    "Pager is waiting for input",
			InputOptions:  []string{"q"},
			Interaction:   "pager",
			ExitKey:       "q",
			Source:        "rules",
		})
	case passwordPromptPattern.MatchString(lastLine):
		return normalizeDetectedInteraction(&detectedInteraction{
			AwaitingInput: true,
			PromptHint:    "Password or passphrase required",
			Interaction:   "password",
			Source:        "rules",
		})
	case confirmPromptPattern.MatchString(lastLine):
		return normalizeDetectedInteraction(&detectedInteraction{
			AwaitingInput: true,
			PromptHint:    strings.TrimSpace(lastLine),
			InputOptions:  []string{"y", "n"},
			Interaction:   "confirm",
			Source:        "rules",
		})
	case enterPromptPattern.MatchString(lastLine):
		return normalizeDetectedInteraction(&detectedInteraction{
			AwaitingInput: true,
			PromptHint:    strings.TrimSpace(lastLine),
			InputOptions:  []string{""},
			Interaction:   "enter",
			Source:        "rules",
		})
	case selectPromptPattern.MatchString(lastLine):
		return normalizeDetectedInteraction(&detectedInteraction{
			AwaitingInput: true,
			PromptHint:    strings.TrimSpace(lastLine),
			Interaction:   "select",
			Source:        "rules",
		})
	default:
		return nil
	}
}

func shouldTriggerInteractionLLMFallback(commandText string, output string, snapshot *wshrpc.CommandAgentGetCommandResultRtnData) bool {
	if interactionDetectorLLM == nil {
		return false
	}
	if snapshot == nil || snapshot.Status != "running" {
		return false
	}
	normalized := normalizeInteractionOutput(output)
	if normalized == "" {
		return false
	}
	lastLine := tailLines(normalized, 1)
	if !llmFallbackCandidatePattern.MatchString(strings.TrimSpace(lastLine)) {
		return false
	}
	return strings.TrimSpace(commandText) != "" || strings.TrimSpace(lastLine) != ""
}

func detectInteractionWithLLMFallback(commandText string, output string, snapshot *wshrpc.CommandAgentGetCommandResultRtnData) *detectedInteraction {
	if !shouldTriggerInteractionLLMFallback(commandText, output, snapshot) {
		return nil
	}
	analyzed, err := interactionDetectorLLM(interactionLLMInput{
		Command: strings.TrimSpace(commandText),
		Output:  tailLines(normalizeInteractionOutput(output), 30),
	})
	if err != nil {
		return nil
	}
	if analyzed == nil {
		return nil
	}
	if analyzed.Source == "" {
		analyzed.Source = "llm"
	}
	return normalizeDetectedInteraction(analyzed)
}

func detectCommandInteraction(commandText string, snapshot *wshrpc.CommandAgentGetCommandResultRtnData) *detectedInteraction {
	fromSnapshot := interactionFromSnapshot(snapshot)
	if fromSnapshot != nil {
		return fromSnapshot
	}
	if snapshot == nil {
		return nil
	}
	byRules := detectInteractionByRules(snapshot.Output)
	if byRules != nil {
		return byRules
	}
	return detectInteractionWithLLMFallback(commandText, snapshot.Output, snapshot)
}
