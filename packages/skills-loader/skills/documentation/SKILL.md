---
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

```javascript
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
```

### Class Documentation

```javascript
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
```

### Inline Comments

Use sparingly for non-obvious code:

```javascript
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
```

## README Documentation

Every project should have a README with:

### Essential Sections

```markdown
# Project Name

Brief description of what the project does (1-2 sentences).

## Installation

Step-by-step installation instructions.

\`\`\`bash
npm install my-package
\`\`\`

## Quick Start

Minimal example to get started.

\`\`\`javascript
import { Thing } from 'my-package';

const thing = new Thing();
thing.doSomething();
\`\`\`

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
```

### Optional Sections

- **Features**: List of key features
- **Requirements**: Prerequisites and dependencies
- **Changelog**: Version history
- **FAQ**: Common questions
- **Troubleshooting**: Common issues and solutions
- **Roadmap**: Planned features

## API Documentation

### REST API Endpoints

```markdown
## Create User

Creates a new user account.

**Endpoint:** `POST /api/users`

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | User's email address |
| name | string | Yes | User's display name |
| role | string | No | User role (default: "user") |

**Example Request:**
\`\`\`json
{
  "email": "user@example.com",
  "name": "John Doe"
}
\`\`\`

**Response:** `201 Created`
\`\`\`json
{
  "id": "usr_123abc",
  "email": "user@example.com",
  "name": "John Doe",
  "createdAt": "2024-01-15T10:30:00Z"
}
\`\`\`

**Errors:**
| Code | Description |
|------|-------------|
| 400 | Invalid request body |
| 409 | Email already exists |
```

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
