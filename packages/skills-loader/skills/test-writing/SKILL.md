---
name: test-writing
description: Write comprehensive unit and integration tests with proper coverage. Use when creating tests, improving test coverage, or setting up testing infrastructure.
---

# Test Writing Guide

Follow these practices to write effective, maintainable tests.

## Test Structure: Arrange-Act-Assert (AAA)

Every test should follow this pattern:

```javascript
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
```

## Naming Conventions

Use descriptive test names that explain:
- What is being tested
- Under what conditions
- What the expected outcome is

Good patterns:
- `should [expected behavior] when [condition]`
- `[method/function] returns [expected] for [input]`
- `[component] displays [expected] when [state]`

```javascript
// Good
test('should throw error when email is invalid')
test('calculateTax returns 0 for tax-exempt items')
test('LoginForm displays error message when credentials are wrong')

// Bad
test('test email')
test('calculateTax works')
test('LoginForm test')
```

## Test Categories

### Unit Tests
Test individual functions/methods in isolation:

```javascript
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
```

### Integration Tests
Test multiple components working together:

```javascript
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
```

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

```javascript
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
```

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

```javascript
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
```

## Test Data

### Use Factories/Builders
```javascript
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
```

### Keep Test Data Minimal
Only include data relevant to the test:

```javascript
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
```

## Async Testing

```javascript
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
```

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
