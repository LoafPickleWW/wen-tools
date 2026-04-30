import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import basicSsl from '@vitejs/plugin-basic-ssl';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), nodePolyfills(), basicSsl()],
  server: {
    proxy: {
      '/socket.io': {
        target: 'https://wen-liquid-auth.onrender.com',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      '/attestation': {
        target: 'https://wen-liquid-auth.onrender.com',
        changeOrigin: true,
        secure: false,
      }
    }
  }
});
