// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

func buildTaskStateSummary(tasks []uctypes.UITaskItem) uctypes.UITaskProgressSummary {
	summary := uctypes.UITaskProgressSummary{Total: len(tasks)}
	for _, task := range tasks {
		switch task.Status {
		case uctypes.TaskItemStatusCompleted:
			summary.Completed++
		case uctypes.TaskItemStatusInProgress:
			summary.InProgress++
		case uctypes.TaskItemStatusBlocked:
			summary.Blocked++
		default:
			summary.Pending++
		}
	}
	if summary.Total > 0 {
		summary.Percent = int(float64(summary.Completed) / float64(summary.Total) * 100)
	}
	return summary
}

func shortenCommandSummary(command string) string {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return "执行命令"
	}
	if len(trimmed) > 48 {
		return fmt.Sprintf("执行命令：%s...", trimmed[:45])
	}
	return fmt.Sprintf("执行命令：%s", trimmed)
}

func readableFallbackTaskTitle(toolCall uctypes.WaveToolCall) string {
	inputMap, _ := toolCall.Input.(map[string]any)
	switch toolCall.Name {
	case "wave_run_command":
		if cmd, ok := inputMap["command"].(string); ok {
			return shortenCommandSummary(cmd)
		}
		return "执行命令"
	case "write_text_file":
		if filename, ok := inputMap["filename"].(string); ok && filename != "" {
			return fmt.Sprintf("写入文件 %s", filename)
		}
		return "写入文件"
	case "edit_text_file":
		if filename, ok := inputMap["filename"].(string); ok && filename != "" {
			return fmt.Sprintf("编辑文件 %s", filename)
		}
		return "编辑文件"
	case "delete_text_file":
		if filename, ok := inputMap["filename"].(string); ok && filename != "" {
			return fmt.Sprintf("删除文件 %s", filename)
		}
		return "删除文件"
	case "read_text_file":
		if filename, ok := inputMap["filename"].(string); ok && filename != "" {
			return fmt.Sprintf("读取文件 %s", filename)
		}
		return "读取文件"
	default:
		return "执行步骤"
	}
}

func buildTaskTitle(toolCall uctypes.WaveToolCall) string {
	if toolCall.ToolUseData != nil && strings.TrimSpace(toolCall.ToolUseData.ToolDesc) != "" {
		return strings.TrimSpace(toolCall.ToolUseData.ToolDesc)
	}
	return readableFallbackTaskTitle(toolCall)
}

func buildTaskStateFromToolCalls(toolCalls []uctypes.WaveToolCall) *uctypes.UITaskProgressState {
	if len(toolCalls) == 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	tasks := make([]uctypes.UITaskItem, 0, len(toolCalls))
	for idx, toolCall := range toolCalls {
		status := uctypes.TaskItemStatusPending
		startedTs := int64(0)
		if idx == 0 {
			status = uctypes.TaskItemStatusInProgress
			startedTs = now
		}
		tasks = append(tasks, uctypes.UITaskItem{
			ID:        toolCall.ID,
			Title:     buildTaskTitle(toolCall),
			Status:    status,
			Order:     idx,
			ToolCalls: []uctypes.UIToolCall{{ID: toolCall.ID, Name: toolCall.Name, Timestamp: now}},
			StartedTs: startedTs,
		})
	}
	return &uctypes.UITaskProgressState{
		Version:       1,
		PlanId:        uuid.NewString(),
		Source:        "system-updated",
		Status:        uctypes.TaskProgressStatusActive,
		CurrentTaskId: tasks[0].ID,
		Tasks:         tasks,
		Summary:       buildTaskStateSummary(tasks),
		LastUpdatedTs: now,
	}
}

func RecordToolCall(chatId string, toolName string, toolCallID string, parameters map[string]any) {
	tracker := GetTodoContextTracker(chatId)
	activeTodoID := tracker.GetActiveTodoID()
	if activeTodoID == "" {
		return
	}
	meta := chatstore.DefaultChatStore.GetSession(chatId)
	if meta == nil || meta.TaskState == nil {
		return
	}
	state := meta.TaskState.Clone()
	toolCall := uctypes.UIToolCall{
		ID:         fmt.Sprintf("tool_%d_%s", time.Now().UnixMilli(), strings.ReplaceAll(toolName, " ", "_")),
		Name:       toolName,
		Parameters: parameters,
		Timestamp:  time.Now().UnixMilli(),
	}
	found := false
	for idx := range state.Tasks {
		if state.Tasks[idx].ID == activeTodoID {
			state.Tasks[idx].ToolCalls = append(state.Tasks[idx].ToolCalls, toolCall)
			state.Tasks[idx].UpdatedTs = time.Now().UnixMilli()
			found = true
			break
		}
	}
	if !found {
		return
	}
	chatstore.DefaultChatStore.UpsertSessionMeta(chatId, nil, uctypes.UIChatSessionMetaUpdate{
		TaskState: state,
	})
}

func mergeTaskStateForToolCalls(existing *uctypes.UITaskProgressState, fallback *uctypes.UITaskProgressState) *uctypes.UITaskProgressState {
	if existing != nil && len(existing.Tasks) > 0 && existing.Source == "model-generated" {
		return existing.Clone()
	}
	return nil
}

func refreshTaskStateFromStore(chatId string, current *uctypes.UITaskProgressState) (*uctypes.UITaskProgressState, bool) {
	meta := chatstore.DefaultChatStore.GetSession(chatId)
	if meta == nil || meta.TaskState == nil || len(meta.TaskState.Tasks) == 0 || meta.TaskState.Source != "model-generated" {
		return current, false
	}
	if current != nil && meta.TaskState.LastUpdatedTs <= current.LastUpdatedTs {
		return current, false
	}
	return meta.TaskState.Clone(), true
}

func advanceTaskStateForToolResult(state *uctypes.UITaskProgressState, result uctypes.AIToolResult) {
	if state == nil {
		return
	}
	now := time.Now().UnixMilli()
	nextTaskIndex := -1
	matchedAny := false
	for idx := range state.Tasks {
		task := &state.Tasks[idx]
		matched := task.ID == result.ToolUseID
		if !matched {
			for _, toolCall := range task.ToolCalls {
				if toolCall.ID == result.ToolUseID {
					matched = true
					break
				}
			}
		}
		if !matched {
			continue
		}
		matchedAny = true
		if result.ErrorText != "" {
			task.Status = uctypes.TaskItemStatusBlocked
			state.Status = uctypes.TaskProgressStatusBlocked
			state.BlockedReason = result.ErrorText
			state.CurrentTaskId = task.ID
			state.LastUpdatedTs = now
			state.Summary = buildTaskStateSummary(state.Tasks)
			return
		}
		task.Status = uctypes.TaskItemStatusCompleted
		task.CompletedTs = now
		task.IsFocused = false
		task.FocusedTs = 0
		nextTaskIndex = idx + 1
		break
	}
	if !matchedAny {
		return
	}
	var nextTodoID string
	if nextTaskIndex >= 0 && nextTaskIndex < len(state.Tasks) {
		state.Tasks[nextTaskIndex].Status = uctypes.TaskItemStatusInProgress
		if state.Tasks[nextTaskIndex].StartedTs == 0 {
			state.Tasks[nextTaskIndex].StartedTs = now
		}
		state.Tasks[nextTaskIndex].IsFocused = true
		state.Tasks[nextTaskIndex].FocusedTs = now
		state.Tasks[nextTaskIndex].UpdatedTs = now
		state.CurrentTaskId = state.Tasks[nextTaskIndex].ID
		nextTodoID = state.Tasks[nextTaskIndex].ID
		state.Status = uctypes.TaskProgressStatusActive
		state.BlockedReason = ""
	} else {
		state.CurrentTaskId = ""
		if state.FocusChain != nil {
			state.FocusChain.FocusedTodoId = ""
		}
		state.Status = uctypes.TaskProgressStatusCompleted
		state.BlockedReason = ""
	}
	state.LastUpdatedTs = now
	state.Summary = buildTaskStateSummary(state.Tasks)
	if state.FocusChain != nil {
		state.FocusChain.TotalTodos = state.Summary.Total
		state.FocusChain.CompletedTodos = state.Summary.Completed
		if state.Summary.Total > 0 {
			state.FocusChain.ChainProgress = int(float64(state.Summary.Completed) / float64(state.Summary.Total) * 100)
		} else {
			state.FocusChain.ChainProgress = 0
		}
		state.FocusChain.AutoTransition = true
		state.FocusChain.LastFocusChangeTs = now
		state.FocusChain.FocusedTodoId = nextTodoID
	}
}

var complexActionPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(部署|安装|搭建|配置|设置|上线|发布|迁移|备份|恢复|初始化|扩容|缩容|加固|升级|维护)`),
	regexp.MustCompile(`(?i)(deploy|install|setup|configure|provision|migrate|backup|restore|initialize|bootstrap|scale|harden|upgrade)`),
}

var complexResourcePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(mysql|postgres|postgresql|redis|mongodb|kafka|zookeeper|nginx|elasticsearch|rabbitmq|consul|etcd|vault|istio|traefik|haproxy|keepalived)`),
	regexp.MustCompile(`(?i)(docker|compose|kubernetes|k8s|helm|jenkins|gitlab|harbor|prometheus|grafana)`),
	regexp.MustCompile(`(?i)(ssl|tls|证书|防火墙|iptables|vpn|wireguard|openvpn|域名|dns|负载均衡|lb)`),
	regexp.MustCompile(`(?i)(数据库|消息队列|缓存|搜索|网关|代理|服务发现)`),
}

var complexContextPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(生产|线上|环境|集群|多节点|高可用|容灾|灾备|灰度|回滚)`),
	regexp.MustCompile(`(?i)(production|cluster|multi-?node|high\s*availability|dr|disaster\s*recovery|canary|rollback)`),
}

var extendedPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(排查|优化|部署|升级|迁移|维护|分析|监控).*(问题|故障|性能|异常|日志|资源|状态)`),
	regexp.MustCompile(`(问题|故障|性能|异常|日志).*(排查|优化|部署|升级|迁移|维护|分析|监控)`),
	regexp.MustCompile(`(批量|全部|所有).*(服务器|应用|数据库|系统|配置)`),
	regexp.MustCompile(`(查看|检查|分析|监控).*(并.*分析|并.*检查|并.*查看|日志|资源|监控)`),
	regexp.MustCompile(`(系统|应用|服务).*(监控|分析|日志|资源|异常|状态)`),
	regexp.MustCompile(`(排查|检查|分析).*(问题|故障|异常|日志)`),
	regexp.MustCompile(`(?i)(first|then|next|finally|step\s*[1-9]|step\s*one)`),
	regexp.MustCompile(`[1-9]\.\s`),
	regexp.MustCompile(`第[一二三四五六七八九十\d][步阶段项]`),
	regexp.MustCompile(`(?i)(check|analyze|examine|monitor|troubleshoot|deploy|optimize|migrate).*(and|then|\s+\w+\s+(and|then))`),
	regexp.MustCompile(`(?i)(system|application|server|database|service).*(monitor|analyze|log|resource|error|issue|anomaly)`),
	regexp.MustCompile(`(?i)(batch|all|multiple).*(server|application|database|system|config)`),
	regexp.MustCompile(`(?i)(troubleshoot|diagnose|investigate).*(problem|issue|error|failure|performance)`),
	regexp.MustCompile(`(?i)(deploy|migrate|backup|restore|upgrade).*(server|application|database|system|production)`),
	regexp.MustCompile(`(?i)(check|analyze|examine|monitor).*(system|application|server|database|log|resource)`),
	regexp.MustCompile(`(?i)(which|what).*(application|process|service).*(consume|using|占用)`),
	regexp.MustCompile(`(?i)(examine|analyze|check).*(log|file|error|anomaly)`),
	regexp.MustCompile(`(?i)(backup|restore).*(database|system|server)`),
}

func matchesAny(text string, patterns []*regexp.Regexp) bool {
	for _, p := range patterns {
		if p.MatchString(text) {
			return true
		}
	}
	return false
}

func isHighComplexityIntent(text string) bool {
	actionHit := matchesAny(text, complexActionPatterns)
	resourceHit := matchesAny(text, complexResourcePatterns)
	contextHit := matchesAny(text, complexContextPatterns)
	return (actionHit && resourceHit) || (resourceHit && contextHit) || (actionHit && contextHit)
}

func countSequenceSignals(text string) int {
	count := 0
	count += len(regexp.MustCompile(`(?:^|\s)(?:[1-9])[\.]\s`).FindAllString(text, -1))
	count += len(regexp.MustCompile(`[一二三四五六七八九十]、`).FindAllString(text, -1))
	count += len(regexp.MustCompile(`(首先|然后|接下来|最后|依次)`).FindAllString(text, -1))
	count += len(regexp.MustCompile(`\b(first|then|next|finally)\b`).FindAllString(text, -1))
	count += len(regexp.MustCompile(`第[一二三四五六七八九十\d][步阶段项]`).FindAllString(text, -1))
	count += len(regexp.MustCompile(`(?i)\bstep\s*(one|two|three|four|five|1|2|3|4|5|6|7|8|9)\b`).FindAllString(text, -1))
	return count
}

func countPatternSignals(text string) int {
	signals := 0
	for _, pattern := range extendedPatterns {
		if pattern.MatchString(text) {
			signals++
		}
	}
	return signals
}

const (
	minMessageLength     = 10
	minStepsForTodo      = 3
	minSignalsForComplex = 1
)

func ShouldCreateTodo(message string) bool {
	if len(message) <= minMessageLength {
		return false
	}
	if isHighComplexityIntent(message) {
		return true
	}
	if countSequenceSignals(message) >= minStepsForTodo {
		return true
	}
	signals := countPatternSignals(message)
	return signals >= minSignalsForComplex
}
