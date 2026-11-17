---
title: Other coding agents
description: What each platform integration can block and resume.
---

The engine is the same in every integration. What changes is each platform's ability
to block a write or resume a session.

| Platform | Installation | Main behavior |
|---|---|---|
| Claude Code | `./install.sh` | Blocks the write and can prevent the end of the turn |
| [Codex](/adapters/codex/) | `cd adapters/codex && ./install.sh` | Blocks patches, returns errors to the agent and holds the end of the turn; hooks must be trusted in `/hooks` |
| [Antigravity](/adapters/antigravity/) | `cd adapters/antigravity && ./install.sh` | Uses pre, post and final hooks; reviewers are reserved for risky changes |
| [OpenCode](/adapters/opencode/) | `cd adapters/opencode && ./install.sh` | Blocks the tool call and resumes the session when the final check fails |
| [Grok Build](/adapters/grok/) | `cd adapters/grok && ./install.sh` | Blocks before writing; a final failure shows up as a denial on the next turn |

Each adapter has its own README with installation, known limits and a verification
walkthrough. An integration is not described as equivalent when the platform does
not offer the same event.

All four adapters copy `smugan-build`, so the contract step reaches all of them.
Codex, Antigravity and OpenCode generate the reviewers from `claude/agents/`, with the
contract reading and the block for whoever receives the review. Grok uses its own
copies of the reviewers, which do not have these changes yet.

Per-task execution was written for Claude Code's `general-purpose` subagent and has
only been verified there. On the other platforms, nothing guarantees that subagent
edits go through the hooks. No adapter installs `smugan-finish`. `smugan contract`
and `smugan why` work with any platform; `smugan doctor` checks only the Claude Code
installation.
