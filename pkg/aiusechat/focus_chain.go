package aiusechat

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/chatstore"
	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
)

const (
	contextWarningLevel  = 50
	contextCriticalLevel = 70
	contextMaximumLevel  = 90
)

type ContextThresholdLevel string

const (
	ContextLevelNormal   ContextThresholdLevel = "normal"
	ContextLevelWarning  ContextThresholdLevel = "warning"
	ContextLevelCritical ContextThresholdLevel = "critical"
	ContextLevelMaximum  ContextThresholdLevel = "maximum"
)

type TodoContextTracker struct {
	sessionID           string
	activeTodoID        string
	contextUsagePercent int
	currentTokenCount   int
	maxContextTokens    int
}

func (t *TodoContextTracker) UpdateContextUsage(tokenCount int, maxTokens int) ContextThresholdLevel {
	t.currentTokenCount = tokenCount
	if maxTokens > 0 {
		t.maxContextTokens = maxTokens
	}
	if t.maxContextTokens > 0 {
		t.contextUsagePercent = min(100, tokenCount*100/t.maxContextTokens)
	}
	return t.getContextLevel()
}

func (t *TodoContextTracker) getContextLevel() ContextThresholdLevel {
	if t.contextUsagePercent >= contextMaximumLevel {
		return ContextLevelMaximum
	}
	if t.contextUsagePercent >= contextCriticalLevel {
		return ContextLevelCritical
	}
	if t.contextUsagePercent >= contextWarningLevel {
		return ContextLevelWarning
	}
	return ContextLevelNormal
}

func (t *TodoContextTracker) ShouldSuggestNewTask() (bool, string) {
	if t.contextUsagePercent >= contextCriticalLevel {
		return true, fmt.Sprintf("Context usage at %d%% (%d/%d tokens). Consider creating a new task.", t.contextUsagePercent, t.currentTokenCount, t.maxContextTokens)
	}
	return false, ""
}

func (t *TodoContextTracker) GetActiveTodoID() string {
	return t.activeTodoID
}

func (t *TodoContextTracker) SetActiveTodoID(id string) {
	t.activeTodoID = id
}

func (t *TodoContextTracker) GetContextUsagePercent() int {
	return t.contextUsagePercent
}

var contextTrackerMu sync.Mutex
var contextTrackers = make(map[string]*TodoContextTracker)

func GetTodoContextTracker(sessionID string) *TodoContextTracker {
	contextTrackerMu.Lock()
	defer contextTrackerMu.Unlock()
	tracker, ok := contextTrackers[sessionID]
	if !ok {
		tracker = &TodoContextTracker{sessionID: sessionID}
		contextTrackers[sessionID] = tracker
	}
	return tracker
}

type FocusChainService struct {
	chatId      string
	state       *uctypes.UITaskProgressState
	transitions []uctypes.UIFocusChainTransition
	tracker     *TodoContextTracker
}

func NewFocusChainService(chatId string, state *uctypes.UITaskProgressState) *FocusChainService {
	svc := &FocusChainService{
		chatId:  chatId,
		state:   state,
		tracker: GetTodoContextTracker(chatId),
	}
	if state.FocusChain != nil {
		svc.tracker.activeTodoID = state.FocusChain.FocusedTodoId
	}
	return svc
}

func (s *FocusChainService) FocusTodo(todoID string, reason string) {
	transition := uctypes.UIFocusChainTransition{
		FromTodoId:               s.state.FocusChain.FocusedTodoId,
		ToTodoId:                 todoID,
		Reason:                   uctypes.FocusTransitionReason(reason),
		Timestamp:                time.Now().UnixMilli(),
		ContextUsageAtTransition: s.tracker.contextUsagePercent,
	}
	s.transitions = append(s.transitions, transition)

	for idx := range s.state.Tasks {
		if s.state.Tasks[idx].IsFocused {
			s.state.Tasks[idx].IsFocused = false
			s.state.Tasks[idx].FocusedTs = 0
		}
	}
	for idx := range s.state.Tasks {
		if s.state.Tasks[idx].ID == todoID {
			s.state.Tasks[idx].IsFocused = true
			s.state.Tasks[idx].FocusedTs = time.Now().UnixMilli()
			if s.state.Tasks[idx].Status == uctypes.TaskItemStatusPending {
				s.state.Tasks[idx].Status = uctypes.TaskItemStatusInProgress
				if s.state.Tasks[idx].StartedTs == 0 {
					s.state.Tasks[idx].StartedTs = time.Now().UnixMilli()
				}
			}
			s.state.Tasks[idx].UpdatedTs = time.Now().UnixMilli()
			break
		}
	}
	s.state.FocusChain.FocusedTodoId = todoID
	s.state.FocusChain.LastFocusChangeTs = time.Now().UnixMilli()
	s.state.FocusChain.AutoTransition = true
	s.state.CurrentTaskId = todoID
	s.tracker.activeTodoID = todoID
}

func (s *FocusChainService) CompleteFocusedTodo() (*uctypes.UITaskItem, *uctypes.UITaskItem) {
	now := time.Now().UnixMilli()
	var completedTodo *uctypes.UITaskItem
	completedIdx := -1
	for idx := range s.state.Tasks {
		if s.state.Tasks[idx].IsFocused {
			s.state.Tasks[idx].Status = uctypes.TaskItemStatusCompleted
			s.state.Tasks[idx].CompletedTs = now
			s.state.Tasks[idx].IsFocused = false
			s.state.Tasks[idx].UpdatedTs = now
			completedTodo = &s.state.Tasks[idx]
			completedIdx = idx
			break
		}
	}
	if completedTodo == nil {
		return nil, nil
	}

	transition := uctypes.UIFocusChainTransition{
		FromTodoId:               completedTodo.ID,
		Reason:                   uctypes.FocusTransitionTaskCompleted,
		Timestamp:                now,
		ContextUsageAtTransition: s.tracker.contextUsagePercent,
	}

	var nextTodo *uctypes.UITaskItem
	for idx := completedIdx + 1; idx < len(s.state.Tasks); idx++ {
		if s.state.Tasks[idx].Status == uctypes.TaskItemStatusPending {
			s.state.Tasks[idx].Status = uctypes.TaskItemStatusInProgress
			s.state.Tasks[idx].IsFocused = true
			s.state.Tasks[idx].FocusedTs = now
			if s.state.Tasks[idx].StartedTs == 0 {
				s.state.Tasks[idx].StartedTs = now
			}
			s.state.Tasks[idx].UpdatedTs = now
			nextTodo = &s.state.Tasks[idx]
			transition.ToTodoId = nextTodo.ID
			break
		}
	}
	s.transitions = append(s.transitions, transition)

	if nextTodo != nil {
		s.state.FocusChain.FocusedTodoId = nextTodo.ID
		s.state.CurrentTaskId = nextTodo.ID
		s.tracker.activeTodoID = nextTodo.ID
	} else {
		s.state.FocusChain.FocusedTodoId = ""
		s.state.CurrentTaskId = ""
		s.tracker.activeTodoID = ""
	}

	s.state.FocusChain.CompletedTodos++
	s.state.FocusChain.LastFocusChangeTs = now
	s.state.FocusChain.AutoTransition = true
	if len(s.state.Tasks) > 0 {
		s.state.FocusChain.ChainProgress = int(float64(s.state.FocusChain.CompletedTodos) / float64(len(s.state.Tasks)) * 100)
	}

	s.state.Summary = buildTaskStateSummary(s.state.Tasks)
	s.state.LastUpdatedTs = now

	if nextTodo == nil {
		s.state.Status = uctypes.TaskProgressStatusCompleted
		s.state.BlockedReason = ""
	} else {
		s.state.Status = uctypes.TaskProgressStatusActive
		s.state.BlockedReason = ""
	}

	return completedTodo, nextTodo
}

func (s *FocusChainService) GetProgressSummary() (total, completed, progressPercent int) {
	total = len(s.state.Tasks)
	for _, task := range s.state.Tasks {
		if task.Status == uctypes.TaskItemStatusCompleted {
			completed++
		}
	}
	if total > 0 {
		progressPercent = int(float64(completed) / float64(total) * 100)
	}
	return
}

func (s *FocusChainService) ShouldSuggestNewTask() (bool, string) {
	return s.tracker.ShouldSuggestNewTask()
}

func (s *FocusChainService) GenerateHandoff() *uctypes.UIFocusChainHandoff {
	var completedWork []string
	var remainingWork []string
	for _, task := range s.state.Tasks {
		if task.Status == uctypes.TaskItemStatusCompleted {
			completedWork = append(completedWork, task.Title)
		} else {
			remainingWork = append(remainingWork, task.Title)
		}
	}
	total, completed, progress := s.GetProgressSummary()
	return &uctypes.UIFocusChainHandoff{
		CompletedWork: strings.Join(completedWork, "\n"),
		CurrentState:  string(s.state.Status),
		NextSteps:     fmt.Sprintf("%d tasks remaining:\n- %s", len(remainingWork), strings.Join(remainingWork, "\n- ")),
		ContextSnapshot: uctypes.UIFocusChainHandoffContext{
			TotalTodos:          total,
			CompletedTodos:      completed,
			ProgressPercent:     progress,
			CurrentContextUsage: s.tracker.contextUsagePercent,
			ActiveTodoID:        s.tracker.activeTodoID,
		},
	}
}

func (s *FocusChainService) GetTransitions() []uctypes.UIFocusChainTransition {
	return s.transitions
}

func (s *FocusChainService) SyncToStore() {
	s.state.LastUpdatedTs = time.Now().UnixMilli()
	s.state.Summary = buildTaskStateSummary(s.state.Tasks)
	if s.state.FocusChain != nil {
		s.state.FocusChain.CurrentContextUsage = s.tracker.contextUsagePercent
	}
	chatstore.DefaultChatStore.UpsertSessionMeta(s.chatId, nil, uctypes.UIChatSessionMetaUpdate{
		TaskState: s.state,
		LastState: string(s.state.Status),
	})
}
