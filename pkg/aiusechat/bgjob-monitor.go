package aiusechat

import (
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
)

const bgJobMonitorInterval = 5 * time.Second
const bgJobPreviewMaxChars = 2400

var terminalJobStatuses = map[string]bool{
	"completed": true,
	"error":     true,
	"gone":      true,
	"cancelled": true,
}

func isTerminalJobStatus(status string) bool {
	return terminalJobStatuses[strings.TrimSpace(status)]
}

func startBackgroundJobMonitor() {
	go func() {
		ticker := time.NewTicker(bgJobMonitorInterval)
		defer ticker.Stop()
		for range ticker.C {
			refreshActiveBackgroundJobs()
		}
	}()
}

func refreshActiveBackgroundJobs() {
	sessions := chatstore.DefaultChatStore.ListSessions("", uctypes.UIChatSessionListOpts{})
	for _, session := range sessions {
		if len(session.BackgroundJobs) == 0 {
			continue
		}
		hasActive := false
		for _, job := range session.BackgroundJobs {
			if !isTerminalJobStatus(job.Status) {
				hasActive = true
				break
			}
		}
		if !hasActive {
			continue
		}
		refreshChatBackgroundJobs(session.ChatId)
	}
}

func refreshChatBackgroundJobs(chatId string) {
	jobs := chatstore.DefaultChatStore.GetBackgroundJobs(chatId)
	if len(jobs) == 0 {
		return
	}
	rpcClient := wshclient.GetBareRpcClient()
	if rpcClient == nil {
		return
	}
	changed := false
	for i, job := range jobs {
		jobId := strings.TrimSpace(job.JobId)
		if jobId == "" || isTerminalJobStatus(job.Status) {
			continue
		}
		snapshot, err := wshclient.AgentGetCommandResultCommand(rpcClient, wshrpc.CommandAgentGetCommandResultData{
			JobId:     jobId,
			TailBytes: 16384,
		}, &wshrpc.RpcOpts{Timeout: 8000})
		if err != nil {
			if job.Status != "error" {
				jobs[i].Status = "error"
				jobs[i].Error = err.Error()
				jobs[i].LastUpdatedTs = time.Now().UnixMilli()
				changed = true
			}
			continue
		}
		newStatus := normalizeBgJobStatus(snapshot)
		newInteraction := bgJobInteractionState(snapshot)
		if job.Status != newStatus || job.InteractionState != newInteraction {
			jobs[i].Status = newStatus
			jobs[i].DurationMs = snapshot.DurationMs
			jobs[i].ExitCode = snapshot.ExitCode
			jobs[i].ExitSignal = snapshot.ExitSignal
			jobs[i].Error = strings.TrimSpace(snapshot.Error)
			jobs[i].OutputPreview = trimBgJobPreview(snapshot.Output)
			jobs[i].InteractionState = newInteraction
			if jobs[i].InteractionState != "" && strings.TrimSpace(snapshot.PromptHint) != "" {
				jobs[i].PromptHint = strings.TrimSpace(snapshot.PromptHint)
			}
			jobs[i].LastUpdatedTs = time.Now().UnixMilli()
			changed = true
		}
	}
	if changed {
		chatstore.DefaultChatStore.ReplaceBackgroundJobs(chatId, nil, jobs)
	}
}

func normalizeBgJobStatus(snapshot *wshrpc.CommandAgentGetCommandResultRtnData) string {
	if snapshot == nil {
		return "error"
	}
	switch strings.TrimSpace(snapshot.Status) {
	case "done":
		return "completed"
	case "error", "gone":
		return "error"
	default:
		return strings.TrimSpace(snapshot.Status)
	}
}

func bgJobInteractionState(snapshot *wshrpc.CommandAgentGetCommandResultRtnData) string {
	if snapshot == nil {
		return ""
	}
	if snapshot.AwaitingInput {
		return "awaiting-input"
	}
	if snapshot.TuiDetected {
		return "tui-detected"
	}
	return ""
}

func trimBgJobPreview(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) <= bgJobPreviewMaxChars {
		return trimmed
	}
	return trimmed[len(trimmed)-bgJobPreviewMaxChars:]
}

func init() {
	startBackgroundJobMonitor()
}
