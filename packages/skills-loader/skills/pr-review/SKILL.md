---
name: pr-review
description: Comprehensive pull request review using a panel of specialized reviewers. Use when reviewing PRs, merge requests, or code changes for approval. Spawns multiple sub-agents with different perspectives for thorough analysis.
metadata:
  panel-size: "3"
  approach: multi-agent
---

# Pull Request Review Process

This skill performs a comprehensive PR review by spawning multiple specialized sub-agents, each focusing on different aspects of the code. The results are then synthesized into a unified review.

## How It Works

1. **Gather Context**: Collect all changes in the PR (files modified, additions, deletions)
2. **Spawn Review Panel**: Launch 3 parallel sub-agents with different review focuses
3. **Collect Reviews**: Gather findings from each reviewer
4. **Synthesize**: Combine into a single comprehensive review

## Review Panel

The review panel consists of three specialized reviewers:

### Reviewer 1: Correctness Focus
- Bugs and logic errors
- Edge cases not handled
- Error handling gaps
- Race conditions
- Breaking changes

### Reviewer 2: Design Focus
- Architecture decisions
- Design patterns usage
- Code organization
- API design
- Scalability concerns
- Maintainability

### Reviewer 3: Details Focus
- Code style consistency
- Naming conventions
- Documentation gaps
- Test coverage
- Performance optimizations
- Minor improvements

## Execution Steps

### Step 1: Gather PR Information

First, collect the changes:

```
1. Get the list of changed files
2. Get the diff for each file
3. Identify the base branch and PR description if available
```

Use these commands:
- `git diff main...HEAD` (or appropriate base branch)
- `git log main..HEAD --oneline` for commits

### Step 2: Launch Review Panel

Use the `task` tool to spawn three parallel sub-agents. Each agent should receive:

1. The full diff of changes
2. Their specific review focus area
3. Instructions to output findings in a structured format

**Agent 1 Prompt (Correctness):**
```
You are a code reviewer focused on CORRECTNESS. Review this PR for:
- Bugs and logic errors
- Unhandled edge cases  
- Missing error handling
- Race conditions or concurrency issues
- Breaking changes to existing functionality

For each issue found, provide:
- Severity (Critical/High/Medium/Low)
- File and line number
- Description of the issue
- Suggested fix

Here are the changes:
[DIFF]
```

**Agent 2 Prompt (Design):**
```
You are a code reviewer focused on DESIGN. Review this PR for:
- Architecture and structural decisions
- Design pattern usage (or missed opportunities)
- Code organization and module boundaries
- API design quality
- Scalability and maintainability concerns

For each concern, provide:
- Impact level (High/Medium/Low)
- Location in code
- Description of the concern
- Recommendation

Here are the changes:
[DIFF]
```

**Agent 3 Prompt (Details):**
```
You are a code reviewer focused on DETAILS. Review this PR for:
- Code style consistency
- Naming clarity and conventions
- Missing or outdated documentation
- Test coverage gaps
- Performance optimization opportunities
- Minor improvements and polish

For each suggestion, provide:
- Category (Style/Docs/Tests/Performance/Other)
- Location
- Suggestion

Here are the changes:
[DIFF]
```

### Step 3: Synthesize Reviews

Combine the three reviews into a unified report:

```markdown
# PR Review Summary

## Overview
[Brief summary of the PR and overall assessment]

## Verdict
[APPROVE / REQUEST_CHANGES / COMMENT]

## Critical Issues (Must Fix)
[Issues from all reviewers that block merge]

## Recommended Changes
[High-impact improvements suggested by reviewers]

## Suggestions
[Nice-to-have improvements]

## Positive Notes
[What was done well]

---
*Review conducted by panel of 3 specialized reviewers*
```

## Review Criteria for Verdict

**APPROVE** when:
- No critical issues found
- No high-severity bugs
- Code meets quality standards

**REQUEST_CHANGES** when:
- Critical bugs found
- Security vulnerabilities present
- Breaking changes without migration path
- Missing required tests for critical paths

**COMMENT** when:
- Minor issues that don't block merge
- Suggestions for improvement
- Questions needing clarification

## Tips for Effective Review

1. **Be specific**: Point to exact lines and explain clearly
2. **Explain why**: Don't just say what's wrong, explain the impact
3. **Offer solutions**: Suggest how to fix issues
4. **Acknowledge good work**: Positive feedback matters
5. **Prioritize**: Focus on what matters most
