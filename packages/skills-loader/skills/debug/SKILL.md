---
name: debug
description: Systematic debugging workflow for tracking down issues and fixing bugs. Use when investigating errors, unexpected behavior, or trying to understand why code is not working.
---

# Systematic Debugging Process

Follow this structured approach to efficiently debug issues:

## 1. Reproduce the Problem

Before debugging, ensure you can consistently reproduce the issue:

- **Get exact steps**: What sequence of actions triggers the problem?
- **Identify inputs**: What data or parameters cause the issue?
- **Note environment**: OS, runtime version, configuration settings
- **Check frequency**: Does it happen every time or intermittently?

If you can't reproduce it:
- Check logs for historical occurrences
- Look for race conditions or timing-dependent behavior
- Consider environment differences (dev vs prod)

## 2. Gather Information

Collect relevant data:

- **Error messages**: Read the full error, not just the summary
- **Stack traces**: Identify the call chain leading to the error
- **Logs**: Check application and system logs around the failure time
- **State**: What was the application state when it failed?

## 3. Form Hypotheses

Based on the information gathered:

1. List possible causes (at least 3 if possible)
2. Rank by likelihood
3. Identify how to test each hypothesis

Common categories:
- **Input issues**: Unexpected/malformed data
- **State issues**: Race conditions, stale data, missing initialization
- **Resource issues**: Memory, connections, file handles
- **Configuration**: Wrong settings, missing env vars
- **Dependencies**: Version conflicts, API changes

## 4. Isolate the Problem

Narrow down the location:

- **Binary search**: If you have a large codebase, bisect to find the problematic area
- **Simplify**: Remove components until the problem disappears
- **Add logging**: Strategic print/log statements at key points
- **Use debugger**: Set breakpoints and inspect state

Key questions:
- When did this last work?
- What changed since then? (check git history)
- Does the problem occur in isolation?

## 5. Debug Strategies

### Print/Log Debugging
```
console.log('[DEBUG] Function entered with:', { param1, param2 });
console.log('[DEBUG] State before operation:', state);
// ... operation ...
console.log('[DEBUG] State after operation:', state);
```

### Interactive Debugging
- Set breakpoints at suspected locations
- Inspect variable values
- Step through execution
- Watch expressions

### Rubber Duck Debugging
- Explain the code line by line
- Often reveals incorrect assumptions

### Git Bisect
When you know it worked before:
```bash
git bisect start
git bisect bad HEAD
git bisect good <known-good-commit>
# Test and mark as good/bad until found
```

## 6. Verify the Fix

Once you've identified and fixed the issue:

1. **Confirm fix**: Does the original reproduction case now work?
2. **Test related cases**: Are there similar scenarios to test?
3. **Check for regressions**: Did the fix break anything else?
4. **Write a test**: Add a test case to prevent recurrence
5. **Document**: Update comments or docs if the issue was subtle

## 7. Root Cause Analysis

For significant bugs, document:

- **What was the bug?**: Clear description
- **Why did it happen?**: Root cause, not just symptoms
- **How was it fixed?**: The solution applied
- **How to prevent recurrence?**: Tests, code changes, process improvements

## Common Debugging Pitfalls

- **Assuming instead of verifying**: Always check your assumptions
- **Debugging the wrong thing**: Verify you're looking at the actual problem
- **Making multiple changes at once**: Change one thing, test, repeat
- **Ignoring warning signs**: Earlier warnings often relate to later errors
- **Tunnel vision**: Take a break if stuck, fresh eyes help

## Quick Reference

| Symptom | Common Causes |
|---------|--------------|
| Null/undefined error | Missing initialization, async timing |
| Off-by-one | Loop bounds, array indexing |
| Intermittent failures | Race conditions, resource exhaustion |
| Works locally, fails in prod | Environment config, data differences |
| Slow performance | N+1 queries, unbounded loops, memory leaks |
