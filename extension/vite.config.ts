import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';

export default defineConfig({
  plugins: [
    crx({ manifest }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Stable filenames — no hash — content script injection never breaks between builds
        entryFileNames: (chunk) => {
          if (chunk.name.includes('index.ts'))        return 'assets/content-script.js';
          if (chunk.name.includes('service-worker'))  return 'assets/service-worker.js';
          if (chunk.name.includes('popup'))           return 'assets/popup.js';
          if (chunk.name.includes('value-resolver'))  return 'assets/value-resolver.js';
          return 'assets/[name].js';
        },
        chunkFileNames:  'assets/[name].js',
        assetFileNames:  'assets/[name].[ext]',
      },
    },
  },
});
