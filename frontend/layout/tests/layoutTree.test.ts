// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { newLayoutNode } from "../lib/layoutNode";
import { computeMoveNode, moveNode } from "../lib/layoutTree";
import {
    DropDirection,
    LayoutTreeActionType,
    LayoutTreeComputeMoveNodeAction,
    LayoutTreeMoveNodeAction,
} from "../lib/types";
import { newLayoutTreeState } from "./model";

test("layoutTreeStateReducer - compute move", () => {
    const node0 = newLayoutNode(undefined, undefined, undefined, { blockId: "node0" });
    const node1 = newLayoutNode(undefined, undefined, undefined, { blockId: "node1" });
    const treeState = newLayoutTreeState(newLayoutNode(undefined, undefined, [node0, node1]));
    assert(treeState.rootNode.children!.length === 2, "root should start with two children");

    const pendingAction = computeMoveNode(treeState, {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: node0.id,
        nodeToMoveId: node1.id,
        direction: DropDirection.Top,
    });
    const moveOperation = pendingAction as LayoutTreeMoveNodeAction;
    assert(moveOperation.node === node1, "move operation node should equal node1");
    assert(moveOperation.parentId === treeState.rootNode.id, "move operation parent should be root");
    assert(moveOperation.index === 0, "move operation index should move node1 to the front");
    moveNode(treeState, moveOperation);
    assert(treeState.rootNode.children!.length === 2, "root should still have two children");
    assert(treeState.rootNode.children![0].data!.blockId === "node1", "root's first child should now be node1");
});

test("computeMove - noop action", () => {
    let nodeToMove = newLayoutNode(undefined, undefined, undefined, { blockId: "nodeToMove" });
    let treeState = newLayoutTreeState(
        newLayoutNode(undefined, undefined, [
            nodeToMove,
            newLayoutNode(undefined, undefined, undefined, { blockId: "otherNode" }),
        ])
    );
    let moveAction: LayoutTreeComputeMoveNodeAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Left,
    };
    let pendingAction = computeMoveNode(treeState, moveAction);

    assert(pendingAction === undefined, "inserting a node to the left of itself should not produce a pendingAction");

    moveAction = {
        type: LayoutTreeActionType.ComputeMove,
        nodeId: treeState.rootNode.id,
        nodeToMoveId: nodeToMove.id,
        direction: DropDirection.Right,
    };

    pendingAction = computeMoveNode(treeState, moveAction);
    assert(pendingAction === undefined, "inserting a node to the right of itself should not produce a pendingAction");
});
