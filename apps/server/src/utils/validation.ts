/**
 * Request body validation utility using Zod schemas.
 *
 * Parses the JSON body from a Hono Context, validates it against the
 * provided Zod schema, and throws a ValidationError on failure.
 * The ValidationError is an HTTPException with a JSON response body.
 */

import { z } from 'zod';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

/**
 * Custom validation error that extends HTTPException.
 * Returns a JSON response body with { error: string }.
 */
export class ValidationError extends HTTPException {
  constructor(message: string) {
    const response = new Response(
      JSON.stringify({ error: message }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
    super(400, { res: response, message });
  }
}

/**
 * Format a single Zod issue into a human-readable error string.
 * When a required field is missing (invalid_type with "received undefined"),
 * we produce "field is required" to match the existing API error convention.
 */
function formatIssue(issue: { code?: string; path: PropertyKey[]; message: string; minimum?: unknown }): string {
  const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '';

  // "X is required" for missing fields
  if (
    issue.code === 'invalid_type' &&
    issue.message.includes('received undefined') &&
    path
  ) {
    return `${path} is required`;
  }

  // "X is required" for empty strings with min(1) constraint
  if (issue.code === 'too_small' && issue.minimum === 1 && path) {
    return `${path} is required`;
  }

  // For invalid_type with received value that isn't undefined, use a generic message
  if (issue.code === 'invalid_type' && path) {
    return `${path}: ${issue.message}`;
  }

  // Default: include path when available
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Parse and validate a JSON request body against a Zod schema.
 *
 * @returns The validated and typed body data.
 * @throws ValidationError (HTTPException subclass) with status 400 if validation fails.
 */
export async function parseBody<T>(c: Context, schema: z.ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ValidationError('Invalid JSON body');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(formatIssue);
    throw new ValidationError(messages.join(', '));
  }
  return result.data;
}

/**
 * Same as parseBody but returns a fallback value instead of throwing
 * when the body is missing or empty (for optional bodies).
 */
export async function parseBodyOptional<T>(
  c: Context,
  schema: z.ZodSchema<T>,
  fallback: T,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fallback;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(formatIssue);
    throw new ValidationError(messages.join(', '));
  }
  return result.data;
}
