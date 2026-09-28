import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@firebase/firestore')) return 'firebase-database';
          if (id.includes('@firebase/auth')) return 'firebase-auth';
          if (id.includes('@firebase/storage')) return 'firebase-storage';
        },
      },
    },
  },
});
