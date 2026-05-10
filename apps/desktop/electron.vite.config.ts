import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { cpSync } from 'fs';

// Packages that need to be bundled (not externalized)
// - Agent packages are ESM-only
// - @ants/ui exports raw TypeScript source with no compiled output
const bundledPackages = [
  '@ants/ui',
  '@ants/agent',
  '@ants/agent-core',
  '@ants/agent-node',
  '@ants/agent-storage',
  '@ants/agent-database',
  '@ants/agent-database-core',
  '@ants/agent-providers',
  '@ants/agent-tools',
  '@ants/agent-tools-terminal',
  '@ants/agent-mcp-stdio',
  '@ants/agent-skills-loader',
  '@ants/agent-auth-anthropic',
  '@ants/agent-config-xdg',
  '@ants/agent-browser-core',
  '@ants/agent-browser-sandbox',
  '@ants/agent-tools-director',
  // NOTE: @ants/agent-memory is NOT bundled here because it depends on
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
        '@ants/ui': resolve(__dirname, '../../packages/ui/src'),
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
        // @ants/agent-memory is loaded via dynamic import() at runtime because
        // it depends on onnxruntime-node which has native .node binaries
        external: ['better-sqlite3', 'keytar', 'playwright', 'node-pty', 'ws', '@ants/agent-memory'],
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
        '@ants/ui': resolve(__dirname, '../../packages/ui/src'),
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
