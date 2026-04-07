// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package aiusechat

import (
	"context"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/web/sse"
)

type PendingActionResult struct {
	Status string
	Value  string
}

type PendingActionRequest struct {
	Kind           string
	result         PendingActionResult
	done           bool
	doneChan       chan struct{}
	mu             sync.Mutex
	onCloseUnregFn func()
}

func (req *PendingActionRequest) update(result PendingActionResult) {
	req.mu.Lock()
	defer req.mu.Unlock()

	if req.done {
		return
	}

	req.result = result
	req.done = true

	if req.onCloseUnregFn != nil {
		req.onCloseUnregFn()
	}

	close(req.doneChan)
}

type PendingActionRegistry struct {
	mu       sync.Mutex
	requests map[string]*PendingActionRequest
}

var globalPendingActionRegistry = &PendingActionRegistry{
	requests: make(map[string]*PendingActionRequest),
}

func (r *PendingActionRegistry) Register(actionId string, req PendingActionRequest) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if req.doneChan == nil {
		req.doneChan = make(chan struct{})
	}
	reqCopy := req
	r.requests[actionId] = &reqCopy
}

func (r *PendingActionRegistry) get(actionId string) (*PendingActionRequest, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	req, exists := r.requests[actionId]
	return req, exists
}

func (r *PendingActionRegistry) Update(actionId string, result PendingActionResult) error {
	req, exists := r.get(actionId)
	if !exists {
		return nil
	}
	req.update(result)
	return nil
}

func (r *PendingActionRegistry) Wait(ctx context.Context, actionId string) (PendingActionResult, error) {
	req, exists := r.get(actionId)
	if !exists {
		return PendingActionResult{Status: uctypes.PendingActionCanceled}, nil
	}

	select {
	case <-ctx.Done():
		return PendingActionResult{}, ctx.Err()
	case <-req.doneChan:
	}

	req.mu.Lock()
	result := req.result
	req.mu.Unlock()

	r.mu.Lock()
	delete(r.requests, actionId)
	r.mu.Unlock()

	return result, nil
}

func (r *PendingActionRegistry) Unregister(actionId string) {
	r.mu.Lock()
	req := r.requests[actionId]
	delete(r.requests, actionId)
	r.mu.Unlock()
	if req != nil {
		req.update(PendingActionResult{Status: uctypes.PendingActionCanceled})
	}
}

func RegisterPendingAction(actionId string, kind string, sseHandler *sse.SSEHandlerCh) {
	req := PendingActionRequest{
		Kind:     kind,
		doneChan: make(chan struct{}),
	}

	if sseHandler != nil {
		onCloseId := sseHandler.RegisterOnClose(func() {
			UpdatePendingAction(actionId, PendingActionResult{Status: uctypes.PendingActionCanceled})
		})
		req.onCloseUnregFn = func() {
			sseHandler.UnregisterOnClose(onCloseId)
		}
	}

	globalPendingActionRegistry.Register(actionId, req)
}

func UpdatePendingAction(actionId string, result PendingActionResult) error {
	return globalPendingActionRegistry.Update(actionId, result)
}

func WaitForPendingAction(ctx context.Context, actionId string) (PendingActionResult, error) {
	return globalPendingActionRegistry.Wait(ctx, actionId)
}

func UnregisterPendingAction(actionId string) {
	globalPendingActionRegistry.Unregister(actionId)
}

func RegisterToolApproval(toolCallId string, sseHandler *sse.SSEHandlerCh) {
	RegisterPendingAction(toolCallId, uctypes.PendingActionToolApproval, sseHandler)
}

func UpdateToolApproval(toolCallId string, approval string) error {
	return UpdatePendingAction(toolCallId, PendingActionResult{
		Status: approval,
		Value:  approval,
	})
}

func WaitForToolApproval(ctx context.Context, toolCallId string) (string, error) {
	result, err := WaitForPendingAction(ctx, toolCallId)
	if err != nil {
		return "", err
	}
	return result.Status, nil
}

func UnregisterToolApproval(toolCallId string) {
	UnregisterPendingAction(toolCallId)
}
