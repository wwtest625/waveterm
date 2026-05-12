package aiusechat

import (
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func GetThinkToolDefinition() uctypes.ToolDefinition {
	return uctypes.ToolDefinition{
		Name:        "waveai_think",
		DisplayName: "Think",
		Description: "Record your internal reasoning process. Use this to organize your thoughts before taking action, especially for complex or multi-step tasks. The content is not shown to the user and does not produce visible output. This tool helps you think through problems methodically.",
		ToolLogName: "wave:think",
		Strict:      true,
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"thought": map[string]any{
					"type":        "string",
					"description": "Your internal reasoning: what you know, what you need to figure out, and your plan of action",
				},
				"action_plan": map[string]any{
					"type":        "string",
					"description": "Brief summary of the next steps you plan to take after this thinking step",
				},
			},
			"required":             []string{"thought"},
			"additionalProperties": false,
		},
		ToolAnyCallback: func(input any, toolUseData *uctypes.UIMessageDataToolUse) (any, error) {
			return map[string]any{"status": "recorded"}, nil
		},
		ToolApproval: func(input any, _ uctypes.ApprovalContext) string { return uctypes.ApprovalAutoApproved },
	}
}
