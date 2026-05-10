---
name: code-review
description: Review code for bugs, style issues, performance problems, and suggest improvements. Use when asked to review code, check for issues, or improve code quality.
---

# Code Review Process

Follow this systematic approach when reviewing code:

## 1. Understand the Context

- Read the code carefully to understand its purpose
- Identify the programming language and framework being used
- Consider the broader system context if visible

## 2. Check for Correctness

- **Logic errors**: Off-by-one errors, incorrect conditions, wrong operators
- **Edge cases**: Null/undefined handling, empty collections, boundary conditions
- **Error handling**: Missing try/catch, unhandled promise rejections, error propagation
- **Race conditions**: Concurrent access issues, async/await problems
- **Resource leaks**: Unclosed connections, memory leaks, file handles

## 3. Evaluate Code Quality

- **Naming**: Are variables, functions, and classes named clearly and consistently?
- **Structure**: Is the code well-organized? Are functions/methods appropriately sized?
- **DRY principle**: Is there duplicated code that should be extracted?
- **Single responsibility**: Does each function/class do one thing well?
- **Comments**: Are complex sections documented? Are there outdated comments?

## 4. Performance Considerations

- **Algorithmic complexity**: Are there O(n²) operations that could be O(n)?
- **Unnecessary work**: Redundant calculations, repeated database queries
- **Memory usage**: Large object allocations, growing collections
- **Caching opportunities**: Repeated expensive operations

## 5. Security Review

- **Input validation**: Is user input sanitized?
- **Authentication/Authorization**: Are access controls in place?
- **Sensitive data**: Are secrets, passwords, or PII exposed?
- **Injection vulnerabilities**: SQL, XSS, command injection

## 6. Provide Constructive Feedback

When providing feedback:

1. **Be specific**: Point to exact lines and explain the issue
2. **Explain why**: Don't just say what's wrong, explain the impact
3. **Suggest fixes**: Provide concrete improvement suggestions
4. **Prioritize**: Distinguish critical issues from minor suggestions
5. **Be kind**: Focus on the code, not the author

## Output Format

Organize your review as:

```
## Summary
Brief overview of the code and overall assessment.

## Critical Issues
Issues that must be fixed (bugs, security vulnerabilities).

## Improvements
Suggested changes to improve quality, performance, or maintainability.

## Minor Suggestions
Nitpicks and style suggestions.

## Positive Notes
What's done well (important for balanced feedback).
```
