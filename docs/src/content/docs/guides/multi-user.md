---
title: Multi-User Mode
description: Set up role-based access control with individual user accounts, local auth, and social OAuth.
sidebar:
  order: 5
---

By default, OpenMgr uses a single bearer token for authentication. Multi-user mode adds individual user accounts with role-based access control.

## Enable Multi-User Mode

Set the environment variable:

```bash
OPENMGR_MULTI_USER=true
```

:::note
`OPENMGR_MULTI_USER` and `OPENMGR_SECRET` are mutually exclusive. When multi-user mode is enabled, bearer token auth is replaced by user accounts.
:::

## Initial Setup

On first launch with multi-user mode, the server enters setup mode.

### Without a Setup Token

If `OPENMGR_SETUP_TOKEN` is not set, the first person to visit the setup page becomes the admin. This is fine for local development but not recommended for production.

### With a Setup Token (recommended)

Set a one-time setup token:

```bash
OPENMGR_SETUP_TOKEN=$(openssl rand -base64 32)
```

The admin must provide this token during initial setup. This prevents unauthorized users from claiming admin access.

## Roles

| Role | Description |
|------|-------------|
| **Admin** | Full access. Can manage users, projects, sessions, and all settings |
| **Operator** | Can create and manage projects and sessions. Cannot manage users |
| **Viewer** | Read-only access to projects and sessions |

## Authentication Methods

### Local Password Auth

Users create accounts with email and password. Passwords are hashed and stored in the SQLite database.

### Social OAuth

Multi-user mode supports OAuth login with:

- **Google**
- **GitHub**
- **Microsoft**

Configure OAuth providers through the web UI settings after initial admin setup.

## API Authentication

In multi-user mode, API requests use session cookies (for browser-based access) or user-specific API tokens instead of the shared bearer token.

## Deployment Considerations

For production multi-user deployments:

1. **Always use HTTPS** — Credentials are transmitted in requests
2. **Set a setup token** — Prevent unauthorized admin creation
3. **Configure OAuth** — Better security than password-only auth
4. **Review roles** — Assign the minimum required role to each user
