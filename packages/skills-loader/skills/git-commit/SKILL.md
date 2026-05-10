---
name: git-commit
description: Create well-formatted commit messages following conventional commit standards. Use when committing changes, writing commit messages, or preparing code for version control.
---

# Git Commit Best Practices

Follow these guidelines when creating commits:

## Conventional Commit Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

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
- Component name: `feat(auth): add login form`
- Module: `fix(api): handle timeout errors`
- File type: `style(css): fix spacing issues`

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
```
fix(auth): handle expired token refresh
```

### Commit with body
```
feat(search): add fuzzy matching to search results

Implement Levenshtein distance algorithm for approximate string
matching. This improves user experience when searching with typos
or partial matches.

- Add fuzzy match scoring
- Configure threshold via FUZZY_THRESHOLD env var
- Update search tests
```

### Breaking change
```
feat(api)!: change response format for user endpoint

BREAKING CHANGE: The user endpoint now returns `userId` instead of `id`.
Clients need to update their response handling.
```

## Pre-Commit Checklist

Before committing:

1. **Review changes**: Run `git diff --staged` to see what you're committing
2. **Check for secrets**: Ensure no API keys, passwords, or tokens are included
3. **Run tests**: Make sure tests pass
4. **Lint check**: Ensure code passes linting rules
5. **Atomic commits**: Each commit should be a single logical change

## Commit Process

1. Stage relevant files: `git add <files>` (prefer selective staging over `git add .`)
2. Review staged changes: `git diff --staged`
3. Write commit message following the format above
4. If there are unstaged changes, consider if they belong in this commit

## When to Split Commits

Split into multiple commits when:
- Changes address different issues/features
- Refactoring is mixed with feature changes
- Test changes could stand alone
- Documentation updates are substantial
