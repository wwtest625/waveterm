// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wcore

import (
	"context"
	"fmt"
	"log"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/eventbus"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

func SwitchWorkspace(ctx context.Context, windowId string, workspaceId string) (*waveobj.Workspace, error) {
	log.Printf("SwitchWorkspace %s %s\n", windowId, workspaceId)
	ws, err := GetWorkspace(ctx, workspaceId)
	if err != nil {
		return nil, fmt.Errorf("error getting new workspace: %w", err)
	}
	window, err := GetWindow(ctx, windowId)
	if err != nil {
		return nil, fmt.Errorf("error getting window: %w", err)
	}
	curWsId := window.WorkspaceId
	if curWsId == workspaceId {
		return nil, nil
	}

	allWindows, err := wstore.DBGetAllObjsByType[*waveobj.Window](ctx, waveobj.OType_Window)
	if err != nil {
		return nil, fmt.Errorf("error getting all windows: %w", err)
	}

	for _, w := range allWindows {
		if w.WorkspaceId == workspaceId {
			log.Printf("workspace %s already has a window %s, focusing that window\n", workspaceId, w.OID)
			client := wshclient.GetBareRpcClient()
			err = wshclient.FocusWindowCommand(client, w.OID, &wshrpc.RpcOpts{Route: wshutil.ElectronRoute})
			return nil, err
		}
	}
	window.WorkspaceId = workspaceId
	err = wstore.DBUpdate(ctx, window)
	if err != nil {
		return nil, fmt.Errorf("error updating window: %w", err)
	}

	deleted, _, err := DeleteWorkspace(ctx, curWsId, false)
	if err != nil && deleted {
		print(err.Error()) // @jalileh isolated the error for now, curwId/workspace was deleted when this occurs.
	} else if err != nil {
		return nil, fmt.Errorf("error deleting workspace: %w", err)
	}

	if !deleted {
		log.Printf("current workspace %s was not deleted\n", curWsId)
	} else {
		log.Printf("deleted current workspace %s\n", curWsId)
	}

	log.Printf("switching window %s to workspace %s\n", windowId, workspaceId)
	return ws, nil
}

func GetWindow(ctx context.Context, windowId string) (*waveobj.Window, error) {
	window, err := wstore.DBMustGet[*waveobj.Window](ctx, windowId)
	if err != nil {
		log.Printf("error getting window %q: %v\n", windowId, err)
		return nil, err
	}
	return window, nil
}

func CreateWindow(ctx context.Context, winSize *waveobj.WinSize, workspaceId string) (*waveobj.Window, error) {
	log.Printf("CreateWindow %v %v\n", winSize, workspaceId)
	var ws *waveobj.Workspace
	if workspaceId == "" {
		ws1, err := CreateWorkspace(ctx, "", "", "", false, false)
		if err != nil {
			return nil, fmt.Errorf("error creating workspace: %w", err)
		}
		ws = ws1
	} else {
		ws1, err := GetWorkspace(ctx, workspaceId)
		if err != nil {
			return nil, fmt.Errorf("error getting workspace: %w", err)
		}
		ws = ws1
	}
	windowId := uuid.NewString()
	if winSize == nil {
		winSize = &waveobj.WinSize{
			Width:  0,
			Height: 0,
		}
	}
	window := &waveobj.Window{
		OID:         windowId,
		WorkspaceId: ws.OID,
		IsNew:       true,
		Pos: waveobj.Point{
			X: 0,
			Y: 0,
		},
		WinSize: *winSize,
	}
	err := wstore.DBInsert(ctx, window)
	if err != nil {
		return nil, fmt.Errorf("error inserting window: %w", err)
	}
	client, err := GetClientData(ctx)
	if err != nil {
		return nil, fmt.Errorf("error getting client: %w", err)
	}
	client.WindowIds = append(client.WindowIds, windowId)
	err = wstore.DBUpdate(ctx, client)
	if err != nil {
		return nil, fmt.Errorf("error updating client: %w", err)
	}
	return GetWindow(ctx, windowId)
}

func MoveTabToNewWindow(ctx context.Context, workspaceId string, tabId string, remainingTabIds []string, pos *waveobj.Point) (*waveobj.Window, string, bool, error) {
	log.Printf("MoveTabToNewWindow %s %s\n", workspaceId, tabId)
	ws, err := GetWorkspace(ctx, workspaceId)
	if err != nil {
		return nil, "", false, fmt.Errorf("error getting workspace: %w", err)
	}
	tabIdx := utilfn.FindStringInSlice(ws.TabIds, tabId)
	if tabIdx == -1 {
		return nil, "", false, fmt.Errorf("tab %s not found in workspace %s", tabId, workspaceId)
	}
	tab, err := wstore.DBMustGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil {
		return nil, "", false, fmt.Errorf("error getting tab %s: %w", tabId, err)
	}

	newWs, err := CreateWorkspace(ctx, "", "", "", false, false)
	if err != nil {
		return nil, "", false, fmt.Errorf("error creating new workspace: %w", err)
	}
	placeholderTabId := newWs.ActiveTabId
	if placeholderTabId == "" {
		_, _, _ = DeleteWorkspace(ctx, newWs.OID, true)
		return nil, "", false, fmt.Errorf("new workspace has no placeholder tab")
	}
	placeholderTab, err := wstore.DBGet[*waveobj.Tab](ctx, placeholderTabId)
	if err != nil {
		_, _, _ = DeleteWorkspace(ctx, newWs.OID, true)
		return nil, "", false, fmt.Errorf("error getting placeholder tab %s: %w", placeholderTabId, err)
	}

	newWindow, err := CreateWindow(ctx, nil, newWs.OID)
	if err != nil {
		_, _, _ = DeleteWorkspace(ctx, newWs.OID, true)
		return nil, "", false, fmt.Errorf("error creating new window: %w", err)
	}

	if len(remainingTabIds) > 0 {
		ws.TabIds = append([]string(nil), remainingTabIds...)
	} else {
		ws.TabIds = utilfn.RemoveElemFromSlice(ws.TabIds, tabId)
	}
	fallbackTabId := ws.ActiveTabId
	if fallbackTabId == tabId {
		if len(ws.TabIds) > 0 {
			fallbackTabId = ws.TabIds[max(0, min(tabIdx-1, len(ws.TabIds)-1))]
		} else {
			fallbackTabId = ""
		}
	}
	ws.ActiveTabId = fallbackTabId

	newWs.TabIds = []string{tabId}
	newWs.ActiveTabId = tabId
	if pos != nil {
		newWindow.Pos = *pos
		newWindow.IsNew = true
	}
	err = wstore.WithTx(ctx, func(tx *wstore.TxWrap) error {
		err = wstore.DBUpdate(tx.Context(), ws)
		if err != nil {
			return fmt.Errorf("error updating source workspace: %w", err)
		}
		err = wstore.DBUpdate(tx.Context(), newWs)
		if err != nil {
			return fmt.Errorf("error updating new workspace: %w", err)
		}
		err = wstore.DBDelete(tx.Context(), waveobj.OType_Tab, placeholderTabId)
		if err != nil {
			return fmt.Errorf("error deleting placeholder tab: %w", err)
		}
		if placeholderTab != nil && placeholderTab.LayoutState != "" {
			err = wstore.DBDelete(tx.Context(), waveobj.OType_LayoutState, placeholderTab.LayoutState)
			if err != nil {
				return fmt.Errorf("error deleting placeholder layout state: %w", err)
			}
		}
		if pos != nil {
			err = wstore.DBUpdate(tx.Context(), newWindow)
			if err != nil {
				return fmt.Errorf("error positioning new window: %w", err)
			}
		}
		return nil
	})
	if err != nil {
		closeErr := CloseWindow(ctx, newWindow.OID, true)
		if closeErr != nil {
			log.Printf("error cleaning up failed detached window %s: %v", newWindow.OID, closeErr)
		}
		return nil, "", false, err
	}
	return newWindow, fallbackTabId, len(ws.TabIds) == 0, nil
}

// CloseWindow closes a window and deletes its workspace if it is empty and not named.
// If fromElectron is true, it does not send an event to Electron.
func CloseWindow(ctx context.Context, windowId string, fromElectron bool) error {
	log.Printf("CloseWindow %s\n", windowId)
	window, err := GetWindow(ctx, windowId)
	if err == nil {
		log.Printf("got window %s\n", windowId)
		deleted, _, err := DeleteWorkspace(ctx, window.WorkspaceId, false)
		if err != nil {
			log.Printf("error deleting workspace: %v\n", err)
		}
		if deleted {
			log.Printf("deleted workspace %s\n", window.WorkspaceId)
		}
		err = wstore.DBDelete(ctx, waveobj.OType_Window, windowId)
		if err != nil {
			return fmt.Errorf("error deleting window: %w", err)
		}
		log.Printf("deleted window %s\n", windowId)
	} else {
		log.Printf("error getting window %s: %v\n", windowId, err)
	}
	client, err := wstore.DBGetSingleton[*waveobj.Client](ctx)
	if err != nil {
		return fmt.Errorf("error getting client: %w", err)
	}
	client.WindowIds = utilfn.RemoveElemFromSlice(client.WindowIds, windowId)
	err = wstore.DBUpdate(ctx, client)
	if err != nil {
		return fmt.Errorf("error updating client: %w", err)
	}
	log.Printf("updated client\n")
	if !fromElectron {
		eventbus.SendEventToElectron(eventbus.WSEventType{
			EventType: eventbus.WSEvent_ElectronCloseWindow,
			Data:      windowId,
		})
	}
	return nil
}

func CheckAndFixWindow(ctx context.Context, windowId string) *waveobj.Window {
	log.Printf("CheckAndFixWindow %s\n", windowId)
	window, err := GetWindow(ctx, windowId)
	if err != nil {
		log.Printf("error getting window %q (in checkAndFixWindow): %v\n", windowId, err)
		return nil
	}
	ws, err := GetWorkspace(ctx, window.WorkspaceId)
	if err != nil {
		log.Printf("error getting workspace %q (in checkAndFixWindow): %v\n", window.WorkspaceId, err)
		CloseWindow(ctx, windowId, false)
		return nil
	}
	if len(ws.TabIds) == 0 {
		log.Printf("fixing workspace with no tabs %q (in checkAndFixWindow)\n", ws.OID)
		_, err = CreateTab(ctx, ws.OID, "", true, false)
		if err != nil {
			log.Printf("error creating tab (in checkAndFixWindow): %v\n", err)
		}
	}
	return window
}

func FocusWindow(ctx context.Context, windowId string) error {
	log.Printf("FocusWindow %s\n", windowId)
	client, err := GetClientData(ctx)
	if err != nil {
		log.Printf("error getting client data: %v\n", err)
		return err
	}
	winIdx := utilfn.SliceIdx(client.WindowIds, windowId)
	if winIdx == -1 {
		log.Printf("window %s not found in client data\n", windowId)
		return nil
	}
	client.WindowIds = utilfn.MoveSliceIdxToFront(client.WindowIds, winIdx)
	log.Printf("client.WindowIds: %v\n", client.WindowIds)
	return wstore.DBUpdate(ctx, client)
}
