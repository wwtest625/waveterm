package aiusechat

import (
	"regexp"
)

type InteractionType string

const (
	InteractionConfirm  InteractionType = "confirm"
	InteractionSelect   InteractionType = "select"
	InteractionPassword InteractionType = "password"
	InteractionPager    InteractionType = "pager"
	InteractionEnter    InteractionType = "enter"
	InteractionFreeform InteractionType = "freeform"
)

type TuiCategory string

const (
	TuiCategoryAlways       TuiCategory = "always"
	TuiCategoryConditional  TuiCategory = "conditional"
	TuiCategoryNonBlacklist TuiCategory = "non-blacklist"
)

type ConfirmValues struct {
	Yes     string `json:"yes"`
	No      string `json:"no"`
	Default string `json:"default,omitempty"`
}

type InteractionResult struct {
	NeedsInteraction  bool            `json:"needsinteraction"`
	InteractionType   InteractionType `json:"interactiontype"`
	PromptHint        string          `json:"prompthint"`
	Options           []string        `json:"options,omitempty"`
	OptionValues      []string        `json:"optionvalues,omitempty"`
	ConfirmValues     *ConfirmValues  `json:"confirmvalues,omitempty"`
	ExitKey           string          `json:"exitkey,omitempty"`
	ExitAppendNewline bool            `json:"exitappendnewline,omitempty"`
}

type QuickPattern struct {
	Pattern       regexp.Regexp
	Type          InteractionType
	ConfirmValues *ConfirmValues
}

var quickPatterns = []QuickPattern{
	{Pattern: *regexp.MustCompile(`(?i)password\s*:`), Type: InteractionPassword},
	{Pattern: *regexp.MustCompile(`(?i)passphrase\s*:`), Type: InteractionPassword},
	{Pattern: *regexp.MustCompile(`(?i)口令\s*:`), Type: InteractionPassword},
	{Pattern: *regexp.MustCompile(`(?i)密码\s*[：:]`), Type: InteractionPassword},
	{Pattern: *regexp.MustCompile(`(?i)\[sudo\]\s*password\s+for`), Type: InteractionPassword},
	{Pattern: *regexp.MustCompile(`验证码\s*[：:]`), Type: InteractionPassword},
	{Pattern: *regexp.MustCompile(`(?i)\[Y/n\]`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "Y", No: "n", Default: "Y"}},
	{Pattern: *regexp.MustCompile(`(?i)\[y/N\]`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "y", No: "N", Default: "N"}},
	{Pattern: *regexp.MustCompile(`(?i)\(yes/no\)`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "yes", No: "no"}},
	{Pattern: *regexp.MustCompile(`(?i)\[是/否\]`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "是", No: "否"}},
	{Pattern: *regexp.MustCompile(`(?i)\bconfirm\b`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "yes", No: "no"}},
	{Pattern: *regexp.MustCompile(`(?i)\bcontinue\?\b`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "yes", No: "no"}},
	{Pattern: *regexp.MustCompile(`是否继续`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "是", No: "否"}},
	{Pattern: *regexp.MustCompile(`确认继续`), Type: InteractionConfirm, ConfirmValues: &ConfirmValues{Yes: "是", No: "否"}},
	{Pattern: *regexp.MustCompile(`(?i)press enter`), Type: InteractionEnter},
	{Pattern: *regexp.MustCompile(`按.*回车`), Type: InteractionEnter},
	{Pattern: *regexp.MustCompile(`(?i)press\s+any\s+key`), Type: InteractionEnter},
	{Pattern: *regexp.MustCompile(`按任意键`), Type: InteractionEnter},
	{Pattern: *regexp.MustCompile(`(?i)hit\s+enter`), Type: InteractionEnter},
	{Pattern: *regexp.MustCompile(`(?i)select\b`), Type: InteractionSelect},
	{Pattern: *regexp.MustCompile(`(?i)choose\b`), Type: InteractionSelect},
	{Pattern: *regexp.MustCompile(`(?i)enter\s+number`), Type: InteractionSelect},
	{Pattern: *regexp.MustCompile(`请输入编号`), Type: InteractionSelect},
	{Pattern: *regexp.MustCompile(`请选择`), Type: InteractionSelect},
	{Pattern: *regexp.MustCompile(`输入序号`), Type: InteractionSelect},
	{Pattern: *regexp.MustCompile(`(?i)--More--\s*$`), Type: InteractionPager},
	{Pattern: *regexp.MustCompile(`\(END\)\s*$`), Type: InteractionPager},
	{Pattern: *regexp.MustCompile(`(?i)press\s+q\s+to\s+quit`), Type: InteractionPager},
	{Pattern: *regexp.MustCompile(`(?i)^:\s*$`), Type: InteractionPager},
}

var promptSuffixPattern = regexp.MustCompile(`[:?：？]\s*$`)

var promptKeywords = []*regexp.Regexp{
	regexp.MustCompile(`(?i)password`), regexp.MustCompile(`(?i)username`), regexp.MustCompile(`(?i)login`),
	regexp.MustCompile(`(?i)enter`), regexp.MustCompile(`(?i)input`), regexp.MustCompile(`输入`),
	regexp.MustCompile(`(?i)confirm`), regexp.MustCompile(`确认`), regexp.MustCompile(`(?i)passphrase`),
	regexp.MustCompile(`(?i)token`), regexp.MustCompile(`(?i)secret`), regexp.MustCompile(`(?i)verification`),
	regexp.MustCompile(`验证码`), regexp.MustCompile(`(?i)choice`), regexp.MustCompile(`选择`),
}

var promptExclusions = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^\s*\[?(INFO|DEBUG|WARN|WARNING|ERROR|TRACE|FATAL)\]?\s*:`),
	regexp.MustCompile(`^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}`),
	regexp.MustCompile(`(?i)https?://`),
	regexp.MustCompile(`^\s*"[\w\-]+"\s*:`),
}

type conditionalTUIRule struct {
	Pattern          *regexp.Regexp
	NonInteractiveArgs []*regexp.Regexp
}

var alwaysTUICommands = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^vim?\b`), regexp.MustCompile(`(?i)^vi\b`),
	regexp.MustCompile(`(?i)^nano\b`), regexp.MustCompile(`(?i)^emacs\b`),
	regexp.MustCompile(`(?i)^tmux\b`), regexp.MustCompile(`(?i)^screen\b`),
	regexp.MustCompile(`(?i)^mc\b`), regexp.MustCompile(`(?i)^nnn\b`),
	regexp.MustCompile(`(?i)^ranger\b`),
}

var conditionalTUICommands = []conditionalTUIRule{
	{Pattern: regexp.MustCompile(`(?i)^top\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`-n\s*\d+`), regexp.MustCompile(`-b\b`)}},
	{Pattern: regexp.MustCompile(`(?i)^htop\b`), NonInteractiveArgs: []*regexp.Regexp{}},
	{Pattern: regexp.MustCompile(`(?i)^mysql\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`-e\s`), regexp.MustCompile(`--execute\b`), regexp.MustCompile(`--batch\b`)}},
	{Pattern: regexp.MustCompile(`(?i)^psql\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`-c\s`), regexp.MustCompile(`--command\b`)}},
	{Pattern: regexp.MustCompile(`(?i)^redis-cli\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`--raw\b`)}},
	{Pattern: regexp.MustCompile(`(?i)^ssh\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`-T\b`), regexp.MustCompile(`(?i)-o\s*BatchMode=yes`)}},
	{Pattern: regexp.MustCompile(`(?i)^mongo\b`), NonInteractiveArgs: []*regexp.Regexp{regexp.MustCompile(`--eval\b`), regexp.MustCompile(`-e\s`)}},
}

var pagerCommands = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^less\b`), regexp.MustCompile(`(?i)^more\b`),
	regexp.MustCompile(`(?i)^man\b`), regexp.MustCompile(`(?i)^view\b`),
	regexp.MustCompile(`(?i)^git\s+log\b`), regexp.MustCompile(`(?i)^git\s+diff\b`),
	regexp.MustCompile(`(?i)^journalctl\b`), regexp.MustCompile(`(?i)^systemctl\s+status\b`),
	regexp.MustCompile(`(?i)\|\s*less\b`), regexp.MustCompile(`(?i)\|\s*more\b`),
}

func classifyTuiCommand(command string) TuiCategory {
	for _, p := range pagerCommands {
		if p.MatchString(command) {
			return TuiCategoryNonBlacklist
		}
	}
	for _, p := range alwaysTUICommands {
		if p.MatchString(command) {
			return TuiCategoryAlways
		}
	}
	for _, rule := range conditionalTUICommands {
		if rule.Pattern.MatchString(command) {
			for _, arg := range rule.NonInteractiveArgs {
				if arg.MatchString(command) {
					return TuiCategoryNonBlacklist
				}
			}
			return TuiCategoryConditional
		}
	}
	return TuiCategoryNonBlacklist
}

type exitKeyRule struct {
	Pattern           *regexp.Regexp
	ExitKey           string
	ExitAppendNewline bool
}

var exitKeyPatterns = []exitKeyRule{
	{Pattern: regexp.MustCompile(`(?i)press\s+q\s+to\s+quit`), ExitKey: "q", ExitAppendNewline: false},
	{Pattern: regexp.MustCompile(`(?i)press\s+q\s+to\s+exit`), ExitKey: "q", ExitAppendNewline: false},
	{Pattern: regexp.MustCompile(`(?i)\(q\s+to\s+quit\)`), ExitKey: "q", ExitAppendNewline: false},
	{Pattern: regexp.MustCompile(`(?i)type\s+quit\s+to\s+exit`), ExitKey: "quit", ExitAppendNewline: true},
	{Pattern: regexp.MustCompile(`(?i)type\s+exit\s+to\s+exit`), ExitKey: "exit", ExitAppendNewline: true},
	{Pattern: regexp.MustCompile(`按\s*q\s*退出`), ExitKey: "q", ExitAppendNewline: false},
	{Pattern: regexp.MustCompile(`输入\s*quit\s*退出`), ExitKey: "quit", ExitAppendNewline: true},
}

var alternateScreenEnterSeqs = []string{"\x1b[?1049h", "\x1b[?47h", "\x1b[?1047h"}
var alternateScreenExitSeqs = []string{"\x1b[?1049l", "\x1b[?47l", "\x1b[?1047l"}

var pagerOutputPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\(END\)\s*$`),
	regexp.MustCompile(`(?i)--More--\s*$`),
	regexp.MustCompile(`(?i)^lines\s+\d+-\d+`),
	regexp.MustCompile(`^\s*:\s*$`),
	regexp.MustCompile(`(?i)Manual page\s+`),
}

const (
	maxDismissCount    = 3
	promptDebounceMs   = 300
	maxHashUnchangedCount = 3
	tuiCancelSilenceMs = 1500
	tuiHardTimeoutMs   = 2000
	pagerObservationMs = 2000
	maxLlmCalls        = 3
)
