import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { cpSync } from 'fs';

// Packages that need to be bundled (not externalized)
// - Agent packages are ESM-only
// - @openmgr/ui exports raw TypeScript source with no compiled output
const bundledPackages = [
  '@openmgr/ui',
  '@openmgr/agent',
  '@openmgr/agent-core',
  '@openmgr/agent-node',
  '@openmgr/agent-storage',
  '@openmgr/agent-database',
  '@openmgr/agent-database-core',
  '@openmgr/agent-providers',
  '@openmgr/agent-tools',
  '@openmgr/agent-tools-terminal',
  '@openmgr/agent-mcp-stdio',
  '@openmgr/agent-skills-loader',
  '@openmgr/agent-auth-anthropic',
  '@openmgr/agent-config-xdg',
  '@openmgr/agent-browser-core',
  '@openmgr/agent-browser-sandbox',
  '@openmgr/agent-tools-director',
  // NOTE: @openmgr/agent-memory is NOT bundled here because it depends on
  // @xenova/transformers → onnxruntime-node which has native .node binaries
  // that Rollup cannot bundle. It is loaded via dynamic import() instead.
  // See desktopBridge.ts.
];

export default defineConfig({
  main: {
    plugins: [
      // Externalize deps except packages that must be bundled
      externalizeDepsPlugin({
        exclude: bundledPackages,
      }),
      // Copy drizzle migration files into dist/drizzle/ so that the bundled
      // migrate.ts can find them via join(__dirname, "../drizzle")
      {
        name: 'copy-drizzle-migrations',
        writeBundle() {
          const src = resolve(__dirname, '../../packages/database/drizzle');
          const dest = resolve(__dirname, 'dist/drizzle');
          cpSync(src, dest, { recursive: true });
        },
      },
    ],
    resolve: {
      alias: {
        '@openmgr/ui': resolve(__dirname, '../../packages/ui/src'),
        'react-native': resolve(__dirname, 'node_modules/react-native-web'),
      },
    },
    build: {
      outDir: 'dist/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
        // Keep native modules and playwright external (playwright needs its own package.json at runtime)
        // node-pty and ws are used by LocalTerminalManager for terminal sessions
        // @openmgr/agent-memory is loaded via dynamic import() at runtime because
        // it depends on onnxruntime-node which has native .node binaries
        external: ['better-sqlite3', 'keytar', 'playwright', 'node-pty', 'ws', '@openmgr/agent-memory'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        'react-native': resolve(__dirname, 'node_modules/react-native-web'),
        '@openmgr/ui': resolve(__dirname, '../../packages/ui/src'),
      },
    },
    server: {
      // Better HMR error handling
      hmr: {
        overlay: true,
      },
    },
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
