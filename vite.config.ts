import { defineConfig, Plugin, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import basicSsl from '@vitejs/plugin-basic-ssl';
function testAgentPlugin(): Plugin {
  return {
    name: 'test-agent-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
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

        if (url.startsWith('/api/opensea')) {
          const parsedUrl = new URL(url, 'http://localhost');
          const slug = parsedUrl.searchParams.get('slug');
          const nextCursor = parsedUrl.searchParams.get('next');
          const limit = parsedUrl.searchParams.get('limit') || '50';

          if (!slug) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Collection slug is required' }));
            return;
          }

          const env = loadEnv('', process.cwd(), '');
          const apiKey = env.VITE_OPENSEA_API_KEY || env.OPENSEA_API_KEY || process.env.VITE_OPENSEA_API_KEY || process.env.OPENSEA_API_KEY;
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'OpenSea API Key is not configured in local environment (.env)' }));
            return;
          }

          try {
            const params = new URLSearchParams({ limit });
            if (nextCursor) params.append('next', nextCursor);

            const openseaUrl = `https://api.opensea.io/api/v2/collection/${slug}/nfts?${params.toString()}`;
            const openseaRes = await fetch(openseaUrl, {
              headers: {
                'Accept': 'application/json',
                'X-API-KEY': apiKey,
              },
            });

            res.statusCode = openseaRes.status;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');

            if (openseaRes.ok) {
              const data = await openseaRes.json();
              res.end(JSON.stringify(data));
            } else {
              const errText = await openseaRes.text();
              res.end(JSON.stringify({ error: `OpenSea API error: ${errText}` }));
            }
          } catch (err: any) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }

        if (url.startsWith('/api/r')) {
          const parsedUrl = new URL(url, 'http://localhost');
          const d = parsedUrl.searchParams.get('d');
          const e = parsedUrl.searchParams.get('e');

          if (!d || !e) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing required parameters: d and e' }));
            return;
          }

          try {
            // Pad base64 if needed
            let base64 = d.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            
            const buffer = Buffer.from(base64, 'base64');
            if (buffer.length < 1) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Invalid data parameter' }));
              return;
            }

            const type = buffer[0];
            let redirectUrl = '';

            if (type === 0 || type === 1) {
              // Contract-nested OpenSea URL
              // 1 byte type + 20 bytes contract + 16 bytes hash2 = 37 bytes
              if (buffer.length < 37) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Invalid data length' }));
                return;
              }
              const subdomain = type === 0 ? 'raw2' : 'i2c';
              const contractBytes = buffer.subarray(1, 21);
              const contract = '0x' + contractBytes.toString('hex');
              const hash2Bytes = buffer.subarray(21, 37);
              const hash2 = hash2Bytes.toString('hex');
              const hash1 = hash2.substring(2);
              
              redirectUrl = `https://${subdomain}.seadn.io/ethereum/${contract}/${hash1}/${hash2}.${e}`;
            } else if (type === 2) {
              // Flat OpenSea URL
              if (buffer.length < 17) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Invalid data length' }));
                return;
              }
              const hashBytes = buffer.subarray(1, 17);
              const hash = hashBytes.toString('hex');
              redirectUrl = `https://i.seadn.io/gcs/files/${hash}.${e}`;
            } else {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Unknown type: ' + type }));
              return;
            }

            res.statusCode = 302;
            res.setHeader('Location', redirectUrl);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end();
          } catch (err: any) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
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
