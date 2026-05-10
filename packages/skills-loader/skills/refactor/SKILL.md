---
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

```
1. Make one small change
2. Run tests
3. If tests pass → commit
4. If tests fail → revert or fix immediately
```

**Never** make multiple refactoring changes between test runs.

## Common Refactoring Patterns

### Extract Function/Method
When code is doing too much or is duplicated:

```javascript
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
```

### Rename for Clarity
When names don't convey meaning:

```javascript
// Before
const d = new Date() - startTime;
function proc(x) { ... }

// After
const elapsedMilliseconds = new Date() - startTime;
function processUserInput(input) { ... }
```

### Replace Magic Numbers/Strings
Extract constants with meaningful names:

```javascript
// Before
if (user.age >= 18) { ... }
setTimeout(fn, 86400000);

// After
const LEGAL_ADULT_AGE = 18;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

if (user.age >= LEGAL_ADULT_AGE) { ... }
setTimeout(fn, ONE_DAY_MS);
```

### Simplify Conditionals
Make conditions more readable:

```javascript
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
```

### Remove Duplication
Extract shared logic:

```javascript
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
```

### Introduce Parameter Object
When functions have many parameters:

```javascript
// Before
function createEvent(name, startDate, endDate, location, maxAttendees, isPublic) { ... }

// After
function createEvent({ name, startDate, endDate, location, maxAttendees, isPublic }) { ... }
```

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
