/**
 * @ants/agent-skills-content
 *
 * Default skill content for Ants Agent.
 * This package contains the raw SKILL.md content as strings,
 * making it platform agnostic (works in Node.js, React Native, browsers).
 *
 * @example
 * ```typescript
 * import { defaultSkills, getSkillContent } from "@ants/agent-skills-content";
 *
 * // Get all skills
 * for (const skill of defaultSkills) {
 *   console.log(skill.name, skill.description);
 * }
 *
 * // Get specific skill content
 * const codeReview = getSkillContent("code-review");
 * ```
 */

/**
 * A skill definition with its full content.
 */
export interface SkillContent {
  /** Skill name identifier */
  name: string;
  /** Brief description of what the skill does */
  description: string;
  /** Full SKILL.md content including frontmatter */
  content: string;
}

/**
 * Code review skill content.
 */
export const CODE_REVIEW_SKILL: SkillContent = {
  name: "code-review",
  description: "Review code for bugs, style issues, performance problems, and suggest improvements",
  content: `---
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

\`\`\`
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
\`\`\`
`,
};

/**
 * Debug skill content.
 */
export const DEBUG_SKILL: SkillContent = {
  name: "debug",
  description: "Systematic debugging approach for identifying and fixing issues",
  content: `---
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
\`\`\`
console.log('[DEBUG] Function entered with:', { param1, param2 });
console.log('[DEBUG] State before operation:', state);
// ... operation ...
console.log('[DEBUG] State after operation:', state);
\`\`\`

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
\`\`\`bash
git bisect start
git bisect bad HEAD
git bisect good <known-good-commit>
# Test and mark as good/bad until found
\`\`\`

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
`,
};

/**
 * Documentation skill content.
 */
export const DOCUMENTATION_SKILL: SkillContent = {
  name: "documentation",
  description: "Write clear and comprehensive documentation for code and APIs",
  content: `---
name: documentation
description: Generate clear documentation for code, APIs, and projects. Use when documenting functions, creating README files, writing API docs, or explaining complex systems.
---

# Documentation Guide

Create clear, useful documentation that helps users and developers understand your code.

## Code Documentation

### Function/Method Documentation

Document public functions with:
- Brief description of what it does
- Parameter descriptions with types
- Return value description
- Exceptions/errors that may be thrown
- Usage example for non-obvious functions

\`\`\`javascript
/**
 * Calculates the compound interest for an investment.
 * 
 * @param {number} principal - The initial investment amount
 * @param {number} rate - Annual interest rate as a decimal (e.g., 0.05 for 5%)
 * @param {number} years - Number of years to compound
 * @param {number} [frequency=12] - Compounding frequency per year (default: monthly)
 * @returns {number} The final amount after compound interest
 * @throws {Error} If principal or years is negative
 * 
 * @example
 * // Calculate 5% interest on $1000 for 10 years, compounded monthly
 * const result = calculateCompoundInterest(1000, 0.05, 10);
 * // Returns: 1647.01
 */
function calculateCompoundInterest(principal, rate, years, frequency = 12) {
  // ...
}
\`\`\`

### Class Documentation

\`\`\`javascript
/**
 * Manages user authentication and session handling.
 * 
 * This service handles:
 * - User login/logout
 * - Session management
 * - Token refresh
 * 
 * @example
 * const auth = new AuthService(config);
 * await auth.login(email, password);
 * console.log(auth.isAuthenticated); // true
 */
class AuthService {
  /**
   * Creates an AuthService instance.
   * @param {AuthConfig} config - Authentication configuration
   */
  constructor(config) { }
}
\`\`\`

### Inline Comments

Use sparingly for non-obvious code:

\`\`\`javascript
// Good: Explains WHY
// Use binary search because the list is always sorted and can be very large
const index = binarySearch(sortedItems, target);

// Bad: Explains WHAT (the code already shows this)
// Increment i by 1
i++;

// Good: Explains business logic
// Tax exemption applies to orders over $100 per state regulation ABC-123
if (orderTotal > 100) {
  taxRate = 0;
}
\`\`\`

## README Documentation

Every project should have a README with:

### Essential Sections

\`\`\`markdown
# Project Name

Brief description of what the project does (1-2 sentences).

## Installation

Step-by-step installation instructions.

\\\`\\\`\\\`bash
npm install my-package
\\\`\\\`\\\`

## Quick Start

Minimal example to get started.

\\\`\\\`\\\`javascript
import { Thing } from 'my-package';

const thing = new Thing();
thing.doSomething();
\\\`\\\`\\\`

## Usage

More detailed usage examples covering common use cases.

## API Reference

Link to detailed API docs or brief overview of main exports.

## Configuration

Available configuration options.

## Contributing

How to contribute to the project.

## License

License information.
\`\`\`

### Optional Sections

- **Features**: List of key features
- **Requirements**: Prerequisites and dependencies
- **Changelog**: Version history
- **FAQ**: Common questions
- **Troubleshooting**: Common issues and solutions
- **Roadmap**: Planned features

## API Documentation

### REST API Endpoints

\`\`\`markdown
## Create User

Creates a new user account.

**Endpoint:** \\\`POST /api/users\\\`

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User's email address |
| name | string | Yes | User's display name |
| role | string | No | User role (default: "user") |

**Example Request:**
\\\`\\\`\\\`json
{
  "email": "user@example.com",
  "name": "John Doe"
}
\\\`\\\`\\\`

**Response:** \\\`201 Created\\\`
\\\`\\\`\\\`json
{
  "id": "usr_123abc",
  "email": "user@example.com",
  "name": "John Doe",
  "createdAt": "2024-01-15T10:30:00Z"
}
\\\`\\\`\\\`

**Errors:**
| Code | Description |
|------|-------------|
| 400 | Invalid request body |
| 409 | Email already exists |
\`\`\`

## Documentation Principles

### Write for Your Audience

- **API users**: Need to know how to use it, not how it works internally
- **Contributors**: Need architecture and design decisions
- **Operators**: Need deployment, configuration, and monitoring info

### Keep It Updated

- Update docs when code changes
- Review docs during code review
- Mark deprecated features clearly
- Include version numbers where relevant

### Make It Scannable

- Use headers and subheaders
- Use bullet points and lists
- Include code examples
- Add tables for structured data
- Keep paragraphs short

### Test Your Documentation

- Follow your own installation instructions on a fresh system
- Try code examples to ensure they work
- Have someone unfamiliar with the code follow the docs

## Documentation Checklist

- [ ] All public functions/methods are documented
- [ ] README explains what the project does and how to use it
- [ ] Installation instructions are complete and tested
- [ ] Common use cases have examples
- [ ] Error conditions are documented
- [ ] Configuration options are listed
- [ ] Breaking changes are clearly marked
`,
};

/**
 * Git commit skill content.
 */
export const GIT_COMMIT_SKILL: SkillContent = {
  name: "git-commit",
  description: "Create well-formatted commit messages following conventional commit standards",
  content: `---
name: git-commit
description: Create well-formatted commit messages following conventional commit standards. Use when committing changes, writing commit messages, or preparing code for version control.
---

# Git Commit Best Practices

Follow these guidelines when creating commits:

## Conventional Commit Format

\`\`\`
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
\`\`\`

### Types

- **feat**: New feature for the user
- **fix**: Bug fix for the user
- **docs**: Documentation only changes
- **style**: Formatting, missing semicolons, etc. (no code change)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding or updating tests
- **chore**: Build process, dependencies, tooling changes
- **ci**: CI/CD configuration changes
- **revert**: Reverting a previous commit

### Scope (optional)

The scope indicates the section of the codebase:
- Component name: \`feat(auth): add login form\`
- Module: \`fix(api): handle timeout errors\`
- File type: \`style(css): fix spacing issues\`

### Subject Line Rules

1. Use imperative mood: "add feature" not "added feature" or "adds feature"
2. Don't capitalize the first letter
3. No period at the end
4. Maximum 50 characters (hard limit: 72)
5. Complete this sentence: "If applied, this commit will..."

## Commit Message Body

When a body is needed:

- Separate from subject with a blank line
- Wrap at 72 characters
- Explain **what** and **why**, not **how**
- Use bullet points for multiple changes

## Examples

### Simple commit
\`\`\`
fix(auth): handle expired token refresh
\`\`\`

### Commit with body
\`\`\`
feat(search): add fuzzy matching to search results

Implement Levenshtein distance algorithm for approximate string
matching. This improves user experience when searching with typos
or partial matches.

- Add fuzzy match scoring
- Configure threshold via FUZZY_THRESHOLD env var
- Update search tests
\`\`\`

### Breaking change
\`\`\`
feat(api)!: change response format for user endpoint

BREAKING CHANGE: The user endpoint now returns \`userId\` instead of \`id\`.
Clients need to update their response handling.
\`\`\`

## Pre-Commit Checklist

Before committing:

1. **Review changes**: Run \`git diff --staged\` to see what you're committing
2. **Check for secrets**: Ensure no API keys, passwords, or tokens are included
3. **Run tests**: Make sure tests pass
4. **Lint check**: Ensure code passes linting rules
5. **Atomic commits**: Each commit should be a single logical change

## Commit Process

1. Stage relevant files: \`git add <files>\` (prefer selective staging over \`git add .\`)
2. Review staged changes: \`git diff --staged\`
3. Write commit message following the format above
4. If there are unstaged changes, consider if they belong in this commit

## When to Split Commits

Split into multiple commits when:
- Changes address different issues/features
- Refactoring is mixed with feature changes
- Test changes could stand alone
- Documentation updates are substantial
`,
};

/**
 * PR review skill content.
 */
export const PR_REVIEW_SKILL: SkillContent = {
  name: "pr-review",
  description: "Review pull requests thoroughly and provide constructive feedback",
  content: `---
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

\`\`\`
1. Get the list of changed files
2. Get the diff for each file
3. Identify the base branch and PR description if available
\`\`\`

Use these commands:
- \`git diff main...HEAD\` (or appropriate base branch)
- \`git log main..HEAD --oneline\` for commits

### Step 2: Launch Review Panel

Use the \`task\` tool to spawn three parallel sub-agents. Each agent should receive:

1. The full diff of changes
2. Their specific review focus area
3. Instructions to output findings in a structured format

**Agent 1 Prompt (Correctness):**
\`\`\`
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
\`\`\`

**Agent 2 Prompt (Design):**
\`\`\`
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
\`\`\`

**Agent 3 Prompt (Details):**
\`\`\`
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
\`\`\`

### Step 3: Synthesize Reviews

Combine the three reviews into a unified report:

\`\`\`markdown
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
\`\`\`

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
`,
};

/**
 * Refactor skill content.
 */
export const REFACTOR_SKILL: SkillContent = {
  name: "refactor",
  description: "Refactor code to improve structure, readability, and maintainability",
  content: `---
name: refactor
description: Guidelines for safe code refactoring while preserving behavior. Use when restructuring code, improving design, reducing duplication, or cleaning up technical debt.
---

# Safe Refactoring Process

Refactoring improves code structure without changing behavior. Follow this process to refactor safely:

## Prerequisites

Before starting any refactoring:

1. **Ensure tests exist**: You need tests to verify behavior is preserved
2. **Tests must pass**: Start from a known-good state
3. **Commit clean state**: Have a clean git state to easily revert if needed
4. **Understand the code**: Read and comprehend what you're refactoring

## The Refactoring Cycle

Repeat this cycle for each small change:

\`\`\`
1. Make one small change
2. Run tests
3. If tests pass → commit
4. If tests fail → revert or fix immediately
\`\`\`

**Never** make multiple refactoring changes between test runs.

## Common Refactoring Patterns

### Extract Function/Method
When code is doing too much or is duplicated:

\`\`\`javascript
// Before
function processOrder(order) {
  // validate
  if (!order.id) throw new Error('Missing id');
  if (!order.items.length) throw new Error('No items');
  
  // calculate total
  let total = 0;
  for (const item of order.items) {
    total += item.price * item.quantity;
  }
  // ... more code
}

// After
function validateOrder(order) {
  if (!order.id) throw new Error('Missing id');
  if (!order.items.length) throw new Error('No items');
}

function calculateOrderTotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function processOrder(order) {
  validateOrder(order);
  const total = calculateOrderTotal(order.items);
  // ... more code
}
\`\`\`

### Rename for Clarity
When names don't convey meaning:

\`\`\`javascript
// Before
const d = new Date() - startTime;
function proc(x) { ... }

// After
const elapsedMilliseconds = new Date() - startTime;
function processUserInput(input) { ... }
\`\`\`

### Replace Magic Numbers/Strings
Extract constants with meaningful names:

\`\`\`javascript
// Before
if (user.age >= 18) { ... }
setTimeout(fn, 86400000);

// After
const LEGAL_ADULT_AGE = 18;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

if (user.age >= LEGAL_ADULT_AGE) { ... }
setTimeout(fn, ONE_DAY_MS);
\`\`\`

### Simplify Conditionals
Make conditions more readable:

\`\`\`javascript
// Before
if (user && user.subscription && user.subscription.active && user.subscription.tier === 'premium') {
  ...
}

// After
function isPremiumUser(user) {
  return user?.subscription?.active && user.subscription.tier === 'premium';
}

if (isPremiumUser(user)) {
  ...
}
\`\`\`

### Remove Duplication
Extract shared logic:

\`\`\`javascript
// Before
function createUser(data) {
  const now = new Date().toISOString();
  return { ...data, createdAt: now, updatedAt: now };
}

function createPost(data) {
  const now = new Date().toISOString();
  return { ...data, createdAt: now, updatedAt: now };
}

// After
function withTimestamps(data) {
  const now = new Date().toISOString();
  return { ...data, createdAt: now, updatedAt: now };
}

function createUser(data) {
  return withTimestamps(data);
}

function createPost(data) {
  return withTimestamps(data);
}
\`\`\`

### Introduce Parameter Object
When functions have many parameters:

\`\`\`javascript
// Before
function createEvent(name, startDate, endDate, location, maxAttendees, isPublic) { ... }

// After
function createEvent({ name, startDate, endDate, location, maxAttendees, isPublic }) { ... }
\`\`\`

## Refactoring Order

When refactoring larger code:

1. **Fix obvious code smells first**: Long methods, duplicated code
2. **Improve naming**: Clear names reveal intent
3. **Extract abstractions**: Create interfaces/classes when patterns emerge
4. **Optimize structure**: Move code to appropriate modules/files

## Red Flags - Don't Refactor Yet

Stop and reconsider if:

- No tests exist for the code
- You don't fully understand the code
- There's a deadline looming
- The code is actively being modified by others
- You're tempted to add features during refactoring

## Refactoring Checklist

Before refactoring:
- [ ] Tests exist and pass
- [ ] Git working directory is clean
- [ ] I understand what the code does

During refactoring:
- [ ] Making small, incremental changes
- [ ] Running tests after each change
- [ ] Committing after each passing test run

After refactoring:
- [ ] All tests pass
- [ ] No behavior has changed
- [ ] Code is easier to understand
- [ ] Changes are committed with clear message
`,
};

/**
 * Security review skill content.
 */
export const SECURITY_REVIEW_SKILL: SkillContent = {
  name: "security-review",
  description: "Review code for security vulnerabilities and suggest fixes",
  content: `---
name: security-review
description: Check code for security vulnerabilities and best practices. Use when reviewing code for security issues, auditing authentication, or checking for common vulnerabilities.
---

# Security Review Guide

Use this checklist to identify security vulnerabilities in code.

## OWASP Top 10 Checks

### 1. Injection

**SQL Injection**
\`\`\`javascript
// VULNERABLE
const query = \`SELECT * FROM users WHERE id = \${userId}\`;

// SAFE - Use parameterized queries
const query = 'SELECT * FROM users WHERE id = ?';
db.query(query, [userId]);
\`\`\`

**Command Injection**
\`\`\`javascript
// VULNERABLE
exec(\`ls \${userInput}\`);

// SAFE - Use safe APIs
const files = fs.readdirSync(sanitizedPath);
\`\`\`

**XSS (Cross-Site Scripting)**
\`\`\`javascript
// VULNERABLE
element.innerHTML = userInput;

// SAFE - Use text content or sanitize
element.textContent = userInput;
// or
element.innerHTML = DOMPurify.sanitize(userInput);
\`\`\`

### 2. Broken Authentication

Check for:
- [ ] Weak password requirements
- [ ] Missing rate limiting on login
- [ ] Session tokens in URLs
- [ ] Sessions that don't expire
- [ ] Passwords stored in plain text
- [ ] Missing multi-factor authentication for sensitive operations

\`\`\`javascript
// VULNERABLE - No rate limiting
app.post('/login', async (req, res) => {
  const user = await authenticate(req.body);
});

// SAFE - Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
app.post('/login', limiter, async (req, res) => {
  const user = await authenticate(req.body);
});
\`\`\`

### 3. Sensitive Data Exposure

Check for:
- [ ] Secrets in source code
- [ ] Sensitive data in logs
- [ ] Unencrypted data transmission
- [ ] Sensitive data in error messages
- [ ] Missing encryption at rest

\`\`\`javascript
// VULNERABLE - Secret in code
const API_KEY = 'sk-abc123secret';

// SAFE - Use environment variables
const API_KEY = process.env.API_KEY;

// VULNERABLE - Sensitive data in logs
console.log('User login:', { email, password, creditCard });

// SAFE - Redact sensitive fields
console.log('User login:', { email, password: '[REDACTED]' });
\`\`\`

### 4. Broken Access Control

Check for:
- [ ] Missing authorization checks
- [ ] Insecure direct object references (IDOR)
- [ ] Missing function-level access control
- [ ] CORS misconfiguration

\`\`\`javascript
// VULNERABLE - No authorization check
app.get('/api/users/:id', async (req, res) => {
  const user = await getUser(req.params.id);
  res.json(user);
});

// SAFE - Check authorization
app.get('/api/users/:id', async (req, res) => {
  if (req.user.id !== req.params.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const user = await getUser(req.params.id);
  res.json(user);
});
\`\`\`

### 5. Security Misconfiguration

Check for:
- [ ] Debug mode in production
- [ ] Default credentials
- [ ] Unnecessary features enabled
- [ ] Missing security headers
- [ ] Outdated dependencies

\`\`\`javascript
// Security headers
app.use(helmet());

// Disable x-powered-by
app.disable('x-powered-by');

// CORS properly configured
app.use(cors({
  origin: ['https://trusted-domain.com'],
  credentials: true
}));
\`\`\`

## Common Vulnerability Patterns

### Prototype Pollution
\`\`\`javascript
// VULNERABLE
function merge(target, source) {
  for (const key in source) {
    target[key] = source[key];
  }
}
// Attacker can set: {"__proto__": {"isAdmin": true}}

// SAFE - Check for prototype properties
function safeMerge(target, source) {
  for (const key in source) {
    if (source.hasOwnProperty(key) && key !== '__proto__') {
      target[key] = source[key];
    }
  }
}
\`\`\`

### Path Traversal
\`\`\`javascript
// VULNERABLE
const filePath = path.join(uploadsDir, req.params.filename);
// Attacker can use: ../../../etc/passwd

// SAFE - Validate path stays within allowed directory
const filePath = path.join(uploadsDir, req.params.filename);
if (!filePath.startsWith(uploadsDir)) {
  return res.status(400).json({ error: 'Invalid path' });
}
\`\`\`

### Insecure Deserialization
\`\`\`javascript
// VULNERABLE - Deserializing untrusted data
const data = eval('(' + userInput + ')');

// SAFE - Use JSON.parse
const data = JSON.parse(userInput);
\`\`\`

### Mass Assignment
\`\`\`javascript
// VULNERABLE - Allows setting any field
User.update(req.body);

// SAFE - Whitelist allowed fields
const { name, email } = req.body;
User.update({ name, email });
\`\`\`

## Security Checklist

### Authentication
- [ ] Passwords hashed with strong algorithm (bcrypt, argon2)
- [ ] Session tokens are cryptographically random
- [ ] Failed login attempts are rate-limited
- [ ] Password reset tokens expire quickly
- [ ] MFA available for sensitive accounts

### Authorization
- [ ] Every endpoint checks authorization
- [ ] Users can only access their own data
- [ ] Admin functions require admin role
- [ ] API tokens have minimal required permissions

### Data Protection
- [ ] All data transmitted over HTTPS
- [ ] Sensitive data encrypted at rest
- [ ] PII properly handled and minimized
- [ ] Data retention policies enforced

### Input Validation
- [ ] All input validated on server side
- [ ] Input length limits enforced
- [ ] File uploads validated and sandboxed
- [ ] URL redirects validated against allowlist

### Logging & Monitoring
- [ ] Security events are logged
- [ ] Logs don't contain sensitive data
- [ ] Failed login attempts are monitored
- [ ] Anomaly detection in place

### Dependencies
- [ ] Dependencies regularly updated
- [ ] Known vulnerable packages replaced
- [ ] Dependency sources verified
- [ ] Lock file used for reproducible builds

## Reporting Findings

Report security issues with:

1. **Severity**: Critical / High / Medium / Low
2. **Location**: File and line number
3. **Description**: What the vulnerability is
4. **Impact**: What an attacker could do
5. **Remediation**: How to fix it
6. **References**: CWE, CVE, OWASP references
`,
};

/**
 * Test writing skill content.
 */
export const TEST_WRITING_SKILL: SkillContent = {
  name: "test-writing",
  description: "Write comprehensive tests for code including unit, integration, and e2e tests",
  content: `---
name: test-writing
description: Write comprehensive unit and integration tests with proper coverage. Use when creating tests, improving test coverage, or setting up testing infrastructure.
---

# Test Writing Guide

Follow these practices to write effective, maintainable tests.

## Test Structure: Arrange-Act-Assert (AAA)

Every test should follow this pattern:

\`\`\`javascript
test('should calculate total with discount', () => {
  // Arrange: Set up test data and conditions
  const cart = new ShoppingCart();
  cart.addItem({ name: 'Widget', price: 100 });
  const discount = { type: 'percentage', value: 10 };
  
  // Act: Execute the code being tested
  const total = cart.calculateTotal(discount);
  
  // Assert: Verify the result
  expect(total).toBe(90);
});
\`\`\`

## Naming Conventions

Use descriptive test names that explain:
- What is being tested
- Under what conditions
- What the expected outcome is

Good patterns:
- \`should [expected behavior] when [condition]\`
- \`[method/function] returns [expected] for [input]\`
- \`[component] displays [expected] when [state]\`

\`\`\`javascript
// Good
test('should throw error when email is invalid')
test('calculateTax returns 0 for tax-exempt items')
test('LoginForm displays error message when credentials are wrong')

// Bad
test('test email')
test('calculateTax works')
test('LoginForm test')
\`\`\`

## Test Categories

### Unit Tests
Test individual functions/methods in isolation:

\`\`\`javascript
describe('formatCurrency', () => {
  test('formats positive numbers with $ prefix', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });
  
  test('formats negative numbers with parentheses', () => {
    expect(formatCurrency(-100)).toBe('($100.00)');
  });
  
  test('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
});
\`\`\`

### Integration Tests
Test multiple components working together:

\`\`\`javascript
describe('UserService', () => {
  let db;
  let userService;
  
  beforeEach(async () => {
    db = await createTestDatabase();
    userService = new UserService(db);
  });
  
  afterEach(async () => {
    await db.cleanup();
  });
  
  test('creates user and sends welcome email', async () => {
    const emailSpy = jest.spyOn(emailService, 'send');
    
    await userService.registerUser({
      email: 'test@example.com',
      name: 'Test User'
    });
    
    const user = await db.users.findByEmail('test@example.com');
    expect(user).toBeDefined();
    expect(emailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'test@example.com' })
    );
  });
});
\`\`\`

## Edge Cases to Test

Always consider:

1. **Boundary conditions**
   - Empty inputs (null, undefined, '', [], {})
   - Single element collections
   - Maximum/minimum values
   
2. **Error conditions**
   - Invalid inputs
   - Network failures
   - Timeout scenarios
   
3. **Concurrent operations**
   - Race conditions
   - Parallel execution

\`\`\`javascript
describe('divideNumbers', () => {
  test('divides positive numbers correctly', () => {
    expect(divideNumbers(10, 2)).toBe(5);
  });
  
  test('throws error when dividing by zero', () => {
    expect(() => divideNumbers(10, 0)).toThrow('Division by zero');
  });
  
  test('handles negative numbers', () => {
    expect(divideNumbers(-10, 2)).toBe(-5);
  });
  
  test('returns Infinity for very small divisors', () => {
    expect(divideNumbers(1, Number.MIN_VALUE)).toBe(Infinity);
  });
});
\`\`\`

## Mocking

### When to Mock
- External APIs and services
- Database calls (for unit tests)
- Time-dependent operations
- Expensive operations

### When NOT to Mock
- The code under test
- Simple utility functions
- Internal collaborators (unless necessary)

\`\`\`javascript
// Mock external API
jest.mock('./api/userApi');

test('fetches and displays user data', async () => {
  // Arrange
  userApi.getUser.mockResolvedValue({
    id: 1,
    name: 'John Doe'
  });
  
  // Act
  const result = await userService.getUserProfile(1);
  
  // Assert
  expect(result.displayName).toBe('John Doe');
  expect(userApi.getUser).toHaveBeenCalledWith(1);
});
\`\`\`

## Test Data

### Use Factories/Builders
\`\`\`javascript
const createUser = (overrides = {}) => ({
  id: 1,
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
  ...overrides
});

test('admin users can delete posts', () => {
  const admin = createUser({ role: 'admin' });
  expect(canDeletePost(admin, somePost)).toBe(true);
});
\`\`\`

### Keep Test Data Minimal
Only include data relevant to the test:

\`\`\`javascript
// Bad - too much irrelevant data
test('calculates user age', () => {
  const user = {
    id: 1,
    name: 'John',
    email: 'john@example.com',
    address: '123 Main St',
    phone: '555-1234',
    birthDate: '1990-01-15',
    // ... many more fields
  };
  expect(calculateAge(user)).toBe(34);
});

// Good - only relevant data
test('calculates user age', () => {
  const user = { birthDate: '1990-01-15' };
  expect(calculateAge(user)).toBe(34);
});
\`\`\`

## Async Testing

\`\`\`javascript
// Promises
test('fetches data successfully', async () => {
  const data = await fetchData();
  expect(data).toHaveProperty('items');
});

// Error handling
test('handles fetch errors', async () => {
  await expect(fetchData('invalid')).rejects.toThrow('Not found');
});

// Timeouts
test('times out slow requests', async () => {
  jest.useFakeTimers();
  
  const promise = fetchWithTimeout(5000);
  jest.advanceTimersByTime(5000);
  
  await expect(promise).rejects.toThrow('Timeout');
  
  jest.useRealTimers();
});
\`\`\`

## Test Coverage Goals

Aim for meaningful coverage, not 100%:

- **Critical paths**: 100% coverage
- **Business logic**: High coverage (80%+)
- **Error handling**: Cover important error cases
- **Edge cases**: Cover known edge cases
- **UI/Boilerplate**: Lower priority

## Test Checklist

When writing tests:
- [ ] Tests are independent and can run in any order
- [ ] Tests clean up after themselves
- [ ] Test names clearly describe what's being tested
- [ ] Each test tests one thing
- [ ] Edge cases and error conditions are covered
- [ ] No test depends on external state or network
- [ ] Tests run fast (< 100ms for unit tests)
`,
};

/**
 * All default skills bundled with Ants Agent.
 */
export const defaultSkills: SkillContent[] = [
  CODE_REVIEW_SKILL,
  DEBUG_SKILL,
  DOCUMENTATION_SKILL,
  GIT_COMMIT_SKILL,
  PR_REVIEW_SKILL,
  REFACTOR_SKILL,
  SECURITY_REVIEW_SKILL,
  TEST_WRITING_SKILL,
];

/**
 * Get skill content by name.
 *
 * @param name - The skill name
 * @returns The skill content or undefined if not found
 */
export function getSkillContent(name: string): SkillContent | undefined {
  return defaultSkills.find((s) => s.name === name);
}

/**
 * Get all skill names.
 */
export function getSkillNames(): string[] {
  return defaultSkills.map((s) => s.name);
}
