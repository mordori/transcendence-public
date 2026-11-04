import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from "node:path"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  server: {
    proxy: {
      "/api": {
        target: "https://localhost:8443",
        changeOrigin: true,
        secure: false,
      },
      "/game": {
        target: "wss://localhost:8443",
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
