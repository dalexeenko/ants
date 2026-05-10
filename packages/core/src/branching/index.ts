/**
 * Conversation Branching - Tree-structured message history.
 * 
 * Enables "what if" scenarios where the conversation can fork into
 * multiple branches. Each branch shares history up to the fork point,
 * then diverges.
 * 
 * Use cases:
 * - Try a different approach without losing the original
 * - Rollback to a previous state if the agent goes down the wrong path
 * - Compare multiple solutions side by side
 * - Exploratory conversations that branch based on user decisions
 */

import type { Message } from "../types.js";
import { generateId } from "../utils/id.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A single node in the conversation tree.
 */
export interface ConversationNode {
  /** Unique ID for this node */
  id: string;
  /** The message at this node */
  message: Message;
  /** Parent node ID (null for root) */
  parentId: string | null;
  /** Child branch IDs */
  childIds: string[];
  /** Branch label (e.g., "approach A", "rollback") */
  label?: string;
  /** When this node was created */
  createdAt: number;
}

/**
 * A named branch in the conversation tree.
 */
export interface Branch {
  /** Unique branch ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** The leaf node ID of this branch (current head) */
  headId: string;
  /** The fork point node ID (where this branch diverged) */
  forkPointId: string | null;
  /** When this branch was created */
  createdAt: number;
  /** Whether this is the active branch */
  isActive: boolean;
}

// ============================================================================
// ConversationTree
// ============================================================================

export class ConversationTree {
  private nodes: Map<string, ConversationNode> = new Map();
  private branches: Map<string, Branch> = new Map();
  private activeBranchId: string;

  constructor() {
    // Create the main branch
    this.activeBranchId = "main";
    this.branches.set("main", {
      id: "main",
      name: "main",
      headId: "",
      forkPointId: null,
      createdAt: Date.now(),
      isActive: true,
    });
  }

  // ============================================================================
  // Message Management
  // ============================================================================

  /**
   * Add a message to the current branch.
   */
  addMessage(message: Message): ConversationNode {
    const branch = this.branches.get(this.activeBranchId)!;
    const parentId = branch.headId || null;

    const node: ConversationNode = {
      id: generateId(),
      message,
      parentId,
      childIds: [],
      createdAt: Date.now(),
    };

    this.nodes.set(node.id, node);

    // Update parent's children
    if (parentId) {
      const parent = this.nodes.get(parentId);
      if (parent) {
        parent.childIds.push(node.id);
      }
    }

    // Update branch head
    branch.headId = node.id;

    return node;
  }

  /**
   * Get the linear message history for the current branch.
   * Walks from root to the current head.
   */
  getMessages(): Message[] {
    const branch = this.branches.get(this.activeBranchId)!;
    if (!branch.headId) return [];

    return this.getPathToNode(branch.headId).map((n) => n.message);
  }

  /**
   * Get all messages from root to a specific node.
   */
  getPathToNode(nodeId: string): ConversationNode[] {
    const path: ConversationNode[] = [];
    let current = this.nodes.get(nodeId);

    while (current) {
      path.unshift(current);
      current = current.parentId ? this.nodes.get(current.parentId) : undefined;
    }

    return path;
  }

  // ============================================================================
  // Branching
  // ============================================================================

  /**
   * Create a new branch from the current position (or a specific node).
   * The new branch becomes active.
   * 
   * @param name - Name for the new branch
   * @param fromNodeId - Node to fork from (defaults to current head)
   */
  createBranch(name: string, fromNodeId?: string): Branch {
    const currentBranch = this.branches.get(this.activeBranchId)!;
    const forkPointId = fromNodeId ?? currentBranch.headId;

    const branch: Branch = {
      id: generateId(),
      name,
      headId: forkPointId, // starts at the fork point
      forkPointId,
      createdAt: Date.now(),
      isActive: false,
    };

    this.branches.set(branch.id, branch);
    return branch;
  }

  /**
   * Switch to a different branch.
   */
  switchBranch(branchId: string): Branch {
    const branch = this.branches.get(branchId);
    if (!branch) {
      throw new Error(`Branch not found: ${branchId}`);
    }

    // Deactivate current branch
    const current = this.branches.get(this.activeBranchId);
    if (current) {
      current.isActive = false;
    }

    // Activate new branch
    branch.isActive = true;
    this.activeBranchId = branchId;

    return branch;
  }

  /**
   * Get the active branch.
   */
  getActiveBranch(): Branch {
    return this.branches.get(this.activeBranchId)!;
  }

  /**
   * Get all branches.
   */
  getBranches(): Branch[] {
    return Array.from(this.branches.values());
  }

  /**
   * Delete a branch (but not the main branch).
   * Nodes shared with other branches are kept.
   */
  deleteBranch(branchId: string): boolean {
    if (branchId === "main") {
      throw new Error("Cannot delete the main branch");
    }

    if (branchId === this.activeBranchId) {
      throw new Error("Cannot delete the active branch. Switch first.");
    }

    return this.branches.delete(branchId);
  }

  // ============================================================================
  // Rollback
  // ============================================================================

  /**
   * Rollback the current branch to a specific node.
   * Messages after the node become orphaned (still in tree but not on any branch path).
   */
  rollback(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const branch = this.branches.get(this.activeBranchId)!;
    branch.headId = nodeId;
  }

  /**
   * Rollback by N messages from the current head.
   */
  rollbackN(count: number): void {
    const messages = this.getMessages();
    if (count >= messages.length) {
      throw new Error(`Cannot rollback ${count} messages from a history of ${messages.length}`);
    }

    const targetIndex = messages.length - count - 1;
    const path = this.getPathToNode(this.getActiveBranch().headId);
    const targetNode = path[targetIndex];
    if (targetNode) {
      this.rollback(targetNode.id);
    }
  }

  // ============================================================================
  // Queries
  // ============================================================================

  /**
   * Get the total number of nodes in the tree.
   */
  get nodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Get the total number of branches.
   */
  get branchCount(): number {
    return this.branches.size;
  }

  /**
   * Get children of a specific node (fork points).
   */
  getChildren(nodeId: string): ConversationNode[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    return node.childIds
      .map((id) => this.nodes.get(id))
      .filter(Boolean) as ConversationNode[];
  }

  /**
   * Check if a node is a fork point (has multiple children).
   */
  isForkPoint(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    return (node?.childIds.length ?? 0) > 1;
  }

  /**
   * Clear the entire tree.
   */
  clear(): void {
    this.nodes.clear();
    this.branches.clear();
    this.activeBranchId = "main";
    this.branches.set("main", {
      id: "main",
      name: "main",
      headId: "",
      forkPointId: null,
      createdAt: Date.now(),
      isActive: true,
    });
  }
}
