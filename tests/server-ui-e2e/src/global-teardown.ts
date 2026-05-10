/**
 * Playwright global teardown for server-ui E2E tests.
 *
 * Stops the server and cleans up temp directories.
 */

export default async function globalTeardown() {
  const server = globalThis.__uiTestServer;
  if (server) {
    console.log('[global-teardown] Stopping server...');
    await server.cleanup();
    console.log('[global-teardown] Server stopped and cleaned up');
  }
}
