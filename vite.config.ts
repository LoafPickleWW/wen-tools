import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import basicSsl from '@vitejs/plugin-basic-ssl';

function testAgentPlugin(): Plugin {
  return {
    name: 'test-agent-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        if (url.startsWith('/api/test-agent')) {
          if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Payment, PAYMENT-SIGNATURE');
            res.statusCode = 200;
            res.end();
            return;
          }

          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', async () => {
            try {
              const { endpointUrl, method = 'GET', headers = {}, body: targetBody } = JSON.parse(body);
              if (!endpointUrl) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'endpointUrl is required' }));
                return;
              }

              const fetchHeaders: Record<string, string> = {
                ...headers,
                'Accept': 'application/json',
              };

              const fetchOptions: RequestInit = {
                method: method.toUpperCase(),
                headers: fetchHeaders,
              };

              if (targetBody && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
                fetchOptions.body = typeof targetBody === 'string' ? targetBody : JSON.stringify(targetBody);
                if (!fetchHeaders['Content-Type']) {
                  fetchHeaders['Content-Type'] = 'application/json';
                }
              }

              const targetRes = await fetch(endpointUrl, fetchOptions);
              const contentType = targetRes.headers.get('content-type') || '';

              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Expose-Headers', 'payment-required, payment-response, x-payment-response, PAYMENT-REQUIRED, PAYMENT-RESPONSE, X-PAYMENT-RESPONSE');

              const headersToForward = [
                'payment-required',
                'payment-response',
                'x-payment-response',
                'PAYMENT-REQUIRED',
                'PAYMENT-RESPONSE',
                'X-PAYMENT-RESPONSE',
                'content-type',
              ];

              for (const h of headersToForward) {
                const val = targetRes.headers.get(h);
                if (val) {
                  res.setHeader(h, val);
                }
              }

              res.statusCode = targetRes.status;

              if (contentType.includes('application/json')) {
                const json = await targetRes.json().catch(() => ({}));
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(json));
              } else {
                res.end(await targetRes.text().catch(() => ''));
              }
            } catch (err: any) {
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Failed to connect to agent endpoint', message: err.message }));
            }
          });
          return;
        }
        next();
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), nodePolyfills(), basicSsl(), testAgentPlugin()],
  optimizeDeps: {
    exclude: ["falcon-signatures"],
  },
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    proxy: {
      '/api/xrpl-mainnet': {
        target: 'https://s2-clio.ripple.com:51234',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/xrpl-mainnet/, '')
      },
      '/api/xrpl-testnet': {
        target: 'https://clio.altnet.rippletest.net:51234',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/xrpl-testnet/, '')
      },
      '/api/koios-mainnet': {
        target: 'https://api.koios.rest/api/v1',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/koios-mainnet/, '')
      },
      '/api/koios-preprod': {
        target: 'https://preprod.koios.rest/api/v1',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/koios-preprod/, '')
      },
      '/api/koios-preview': {
        target: 'https://preview.koios.rest/api/v1',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/koios-preview/, '')
      },
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
