// vite.config.ts
import { defineConfig } from "file:///C:/Users/cecal/OneDrive/Documents/Website/wen-tools/node_modules/.pnpm/vite@5.4.14_@types+node@22.10.10/node_modules/vite/dist/node/index.js";
import react from "file:///C:/Users/cecal/OneDrive/Documents/Website/wen-tools/node_modules/.pnpm/@vitejs+plugin-react@4.3.4_vite@5.4.14_@types+node@22.10.10_/node_modules/@vitejs/plugin-react/dist/index.mjs";
import { nodePolyfills } from "file:///C:/Users/cecal/OneDrive/Documents/Website/wen-tools/node_modules/.pnpm/vite-plugin-node-polyfills@_8593b9730d34535d4b5014108c2bab6d/node_modules/vite-plugin-node-polyfills/dist/index.js";
import basicSsl from "file:///C:/Users/cecal/OneDrive/Documents/Website/wen-tools/node_modules/.pnpm/@vitejs+plugin-basic-ssl@2._06db16a3ecc531414254e0da1762a1e3/node_modules/@vitejs/plugin-basic-ssl/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [react(), nodePolyfills(), basicSsl()],
  optimizeDeps: {
    exclude: ["falcon-signatures"]
  },
  server: {
    proxy: {
      "/socket.io": {
        target: "https://wen-liquid-auth.onrender.com",
        changeOrigin: true,
        secure: false,
        ws: true
      },
      "/attestation": {
        target: "https://wen-liquid-auth.onrender.com",
        changeOrigin: true,
        secure: false
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxjZWNhbFxcXFxPbmVEcml2ZVxcXFxEb2N1bWVudHNcXFxcV2Vic2l0ZVxcXFx3ZW4tdG9vbHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkM6XFxcXFVzZXJzXFxcXGNlY2FsXFxcXE9uZURyaXZlXFxcXERvY3VtZW50c1xcXFxXZWJzaXRlXFxcXHdlbi10b29sc1xcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vQzovVXNlcnMvY2VjYWwvT25lRHJpdmUvRG9jdW1lbnRzL1dlYnNpdGUvd2VuLXRvb2xzL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcclxuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xyXG5pbXBvcnQgeyBub2RlUG9seWZpbGxzIH0gZnJvbSBcInZpdGUtcGx1Z2luLW5vZGUtcG9seWZpbGxzXCI7XHJcbmltcG9ydCBiYXNpY1NzbCBmcm9tICdAdml0ZWpzL3BsdWdpbi1iYXNpYy1zc2wnO1xyXG5cclxuLy8gaHR0cHM6Ly92aXRlLmRldi9jb25maWcvXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgcGx1Z2luczogW3JlYWN0KCksIG5vZGVQb2x5ZmlsbHMoKSwgYmFzaWNTc2woKV0sXHJcbiAgb3B0aW1pemVEZXBzOiB7XHJcbiAgICBleGNsdWRlOiBbXCJmYWxjb24tc2lnbmF0dXJlc1wiXSxcclxuICB9LFxyXG4gIHNlcnZlcjoge1xyXG4gICAgcHJveHk6IHtcclxuICAgICAgJy9zb2NrZXQuaW8nOiB7XHJcbiAgICAgICAgdGFyZ2V0OiAnaHR0cHM6Ly93ZW4tbGlxdWlkLWF1dGgub25yZW5kZXIuY29tJyxcclxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXHJcbiAgICAgICAgc2VjdXJlOiBmYWxzZSxcclxuICAgICAgICB3czogdHJ1ZSxcclxuICAgICAgfSxcclxuICAgICAgJy9hdHRlc3RhdGlvbic6IHtcclxuICAgICAgICB0YXJnZXQ6ICdodHRwczovL3dlbi1saXF1aWQtYXV0aC5vbnJlbmRlci5jb20nLFxyXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuICAgICAgICBzZWN1cmU6IGZhbHNlLFxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG59KTtcclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5VixTQUFTLG9CQUFvQjtBQUN0WCxPQUFPLFdBQVc7QUFDbEIsU0FBUyxxQkFBcUI7QUFDOUIsT0FBTyxjQUFjO0FBR3JCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLEdBQUcsY0FBYyxHQUFHLFNBQVMsQ0FBQztBQUFBLEVBQzlDLGNBQWM7QUFBQSxJQUNaLFNBQVMsQ0FBQyxtQkFBbUI7QUFBQSxFQUMvQjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sT0FBTztBQUFBLE1BQ0wsY0FBYztBQUFBLFFBQ1osUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLFFBQ2QsUUFBUTtBQUFBLFFBQ1IsSUFBSTtBQUFBLE1BQ047QUFBQSxNQUNBLGdCQUFnQjtBQUFBLFFBQ2QsUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLFFBQ2QsUUFBUTtBQUFBLE1BQ1Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
