/**
 * @openmgr/agent-auth-anthropic
 * 
 * Anthropic OAuth authentication utilities for OpenMgr Agent.
 * 
 * This package provides OAuth flow utilities for the PKCE flow:
 * - PKCE utilities (code verifier/challenge generation)
 * - Login, token exchange, and refresh functions
 * - Token storage abstraction
 * 
 * For the OAuth provider, use `AnthropicOAuthProvider` from `@openmgr/agent-providers`.
 * 
 * @example
 * ```typescript
 * import { login, isLoggedIn, WebCryptoPKCEUtils } from "@openmgr/agent-auth-anthropic";
 * import { AnthropicOAuthProvider } from "@openmgr/agent-providers";
 * 
 * // Check if logged in
 * if (!await isLoggedIn(tokenStore)) {
 *   // Login flow
 *   const { tokens } = await login(tokenStore, pkce, callbackHandler);
 * }
 * 
 * // Create provider with tokens
 * const provider = new AnthropicOAuthProvider({
 *   tokens: await tokenStore.loadTokens(),
 *   onTokenRefresh: (tokens) => tokenStore.saveTokens(tokens),
 * });
 * ```
 */

// OAuth utilities - platform agnostic
export {
  // PKCE utilities
  WebCryptoPKCEUtils,
  generateCodeVerifier,
  generateCodeChallenge,
  // OAuth flow functions (require OAuthTokenStore)
  login,
  exchangeCode,
  isLoggedIn,
  getValidAccessToken,
  createOAuthHandler,
  // URL generation
  generateAuthorizationUrl,
  // Re-exports from auth-core
  refreshAccessToken,
  exchangeCodeForTokens,
  shouldRefreshTokens,
  buildAuthorizationUrl,
  ANTHROPIC_OAUTH_CONFIG,
  // Types
  type OAuthTokens,
  type OAuthTokenStore,
  type PKCEUtils,
  type OAuthFlowHandler,
  type LoginResult,
  type AuthorizationInfo,
} from "./oauth.js";
