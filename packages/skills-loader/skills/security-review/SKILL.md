---
name: security-review
description: Check code for security vulnerabilities and best practices. Use when reviewing code for security issues, auditing authentication, or checking for common vulnerabilities.
---

# Security Review Guide

Use this checklist to identify security vulnerabilities in code.

## OWASP Top 10 Checks

### 1. Injection

**SQL Injection**
```javascript
// VULNERABLE
const query = `SELECT * FROM users WHERE id = ${userId}`;

// SAFE - Use parameterized queries
const query = 'SELECT * FROM users WHERE id = ?';
db.query(query, [userId]);
```

**Command Injection**
```javascript
// VULNERABLE
exec(`ls ${userInput}`);

// SAFE - Use safe APIs
const files = fs.readdirSync(sanitizedPath);
```

**XSS (Cross-Site Scripting)**
```javascript
// VULNERABLE
element.innerHTML = userInput;

// SAFE - Use text content or sanitize
element.textContent = userInput;
// or
element.innerHTML = DOMPurify.sanitize(userInput);
```

### 2. Broken Authentication

Check for:
- [ ] Weak password requirements
- [ ] Missing rate limiting on login
- [ ] Session tokens in URLs
- [ ] Sessions that don't expire
- [ ] Passwords stored in plain text
- [ ] Missing multi-factor authentication for sensitive operations

```javascript
// VULNERABLE - No rate limiting
app.post('/login', async (req, res) => {
  const user = await authenticate(req.body);
});

// SAFE - Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
app.post('/login', limiter, async (req, res) => {
  const user = await authenticate(req.body);
});
```

### 3. Sensitive Data Exposure

Check for:
- [ ] Secrets in source code
- [ ] Sensitive data in logs
- [ ] Unencrypted data transmission
- [ ] Sensitive data in error messages
- [ ] Missing encryption at rest

```javascript
// VULNERABLE - Secret in code
const API_KEY = 'sk-abc123secret';

// SAFE - Use environment variables
const API_KEY = process.env.API_KEY;

// VULNERABLE - Sensitive data in logs
console.log('User login:', { email, password, creditCard });

// SAFE - Redact sensitive fields
console.log('User login:', { email, password: '[REDACTED]' });
```

### 4. Broken Access Control

Check for:
- [ ] Missing authorization checks
- [ ] Insecure direct object references (IDOR)
- [ ] Missing function-level access control
- [ ] CORS misconfiguration

```javascript
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
```

### 5. Security Misconfiguration

Check for:
- [ ] Debug mode in production
- [ ] Default credentials
- [ ] Unnecessary features enabled
- [ ] Missing security headers
- [ ] Outdated dependencies

```javascript
// Security headers
app.use(helmet());

// Disable x-powered-by
app.disable('x-powered-by');

// CORS properly configured
app.use(cors({
  origin: ['https://trusted-domain.com'],
  credentials: true
}));
```

## Common Vulnerability Patterns

### Prototype Pollution
```javascript
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
```

### Path Traversal
```javascript
// VULNERABLE
const filePath = path.join(uploadsDir, req.params.filename);
// Attacker can use: ../../../etc/passwd

// SAFE - Validate path stays within allowed directory
const filePath = path.join(uploadsDir, req.params.filename);
if (!filePath.startsWith(uploadsDir)) {
  return res.status(400).json({ error: 'Invalid path' });
}
```

### Insecure Deserialization
```javascript
// VULNERABLE - Deserializing untrusted data
const data = eval('(' + userInput + ')');

// SAFE - Use JSON.parse
const data = JSON.parse(userInput);
```

### Mass Assignment
```javascript
// VULNERABLE - Allows setting any field
User.update(req.body);

// SAFE - Whitelist allowed fields
const { name, email } = req.body;
User.update({ name, email });
```

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
