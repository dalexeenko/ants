import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/app/',
  server: {
    proxy: {
      '/api': 'http://localhost:6647',
      '/login': 'http://localhost:6647',
      '/auth': 'http://localhost:6647',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      'react-native': resolve(__dirname, 'node_modules/react-native-web'),
      '@ants/ui': resolve(__dirname, '../ui/src'),
    },
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  },
  define: {
    // React Native Web needs this
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
});
