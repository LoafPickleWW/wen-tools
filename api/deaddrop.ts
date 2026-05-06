import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';
import algosdk from 'algosdk';

/**
 * Dead Drop Relay API
 * Handles encrypted payload storage and signature-verified retrieval using Standard Redis Protocol.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Resolve the best available URL (redis:// or rediss://)
  const url = process.env.KV_URL || process.env.REDIS_URL || process.env.STORAGE_URL || '';

  if (!url) {
    return res.status(500).json({ 
      error: 'Redis Storage not detected in environment.',
      debug: { 
        tip: 'Ensure REDIS_URL or KV_URL is set in your Vercel project.'
      }
    });
  }

  // Initialize Standard Redis Client
  const client = createClient({ url });
  client.on('error', (err) => console.error('Redis Client Error', err));

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    await client.connect();

    if (req.method === 'POST') {
      const { recipient, expiry, ...rest } = req.body;
      
      if (!recipient) {
        await client.disconnect();
        return res.status(400).json({ error: 'Missing recipient' });
      }

      // Store the entire payload in Redis
      const key = `dd:${recipient}:${Date.now()}`;
      console.log(`[API] 🚀 Storing drop for: ${recipient} (Key: ${key})`);
      
      await client.set(key, JSON.stringify({ ...rest, recipient }), {
        EX: expiry || 86400 // 24h default
      });
      
      await client.disconnect();
      return res.status(200).json({ success: true, id: key });
    }

    if (req.method === 'GET') {
      const { address, sig, txn } = req.query;

      if (!address || !sig || !txn) {
        await client.disconnect();
        return res.status(400).json({ error: 'Missing auth parameters' });
      }

      // 1. Verify Signature (Proof of Identity)
      try {
        const decodedTxn = algosdk.decodeSignedTransaction(Buffer.from(txn as string, 'base64'));
        const sgnrPK = (decodedTxn.sgnr || decodedTxn.txn.from.publicKey) as Uint8Array;
        const sgnrAddr = algosdk.encodeAddress(sgnrPK);
        
        // Verify signature is mathematically valid (Using raw PK bytes)
        const rawTxn = decodedTxn.txn;
        const validSig = (algosdk as any).verifyBytes(
          rawTxn.bytesToSign(), 
          decodedTxn.sig!, 
          sgnrPK
        );
        if (!validSig) throw new Error('Signature invalid');
        
        console.log(`[API] 🕵️ Signature valid for address: ${address}`);

        // Verify Authority (Handle Rekeying and NFDs)
        const indexerUrl = process.env.VITE_NETWORK === 'testnet' 
          ? 'https://testnet-idx.algonode.cloud' 
          : 'https://mainnet-idx.algonode.cloud';

        const indexer = new algosdk.Indexer('', indexerUrl, '');

        // Sledgehammer Sanitization: Strip everything except A-Z and 2-7
        let targetAccount = (address as string || '').toUpperCase().replace(/[^A-Z2-7]/g, '');

        // If it was an NFD name (which would have been stripped to almost nothing), resolve it
        if ((address as string || '').toLowerCase().endsWith('.algo')) {
          const nfdRes = await fetch(`https://api.nf.domains/nfd/${(address as string).toLowerCase()}?view=tiny`).then(r => r.json());
          if (nfdRes.depositAccount) targetAccount = nfdRes.depositAccount.toUpperCase().replace(/[^A-Z2-7]/g, '');
        }

        // Only check Indexer if we have a valid 58-char address
        if (targetAccount.length === 58 && algosdk.isValidAddress(targetAccount)) {
          try {
            console.log(`[API] 🔍 Requesting Indexer for account: "${targetAccount}"`);
            const accountInfo = await indexer.lookupAccountByID(targetAccount).do();
            const authorizedSigner = (accountInfo.account['auth-addr'] || targetAccount).toUpperCase().replace(/[^A-Z2-7]/g, '');
            
            if (sgnrAddr !== authorizedSigner) {
              throw new Error(`Signer ${sgnrAddr} is not authorized for ${targetAccount}`);
            }
          } catch (indexerErr: any) {
            console.error(`[API] Indexer Error for ${targetAccount}:`, indexerErr.message);
            // Fallback: If indexer fails (e.g. account doesn't exist), only allow if signer == address
            if (sgnrAddr !== targetAccount) {
              throw new Error(`Identity mismatch and indexer lookup failed for ${targetAccount}. Indexer said: ${indexerErr.message}`);
            }
          }
        } else if (sgnrAddr !== targetAccount) {
          throw new Error(`Identity mismatch or invalid identity format: "${targetAccount}" (Length: ${targetAccount.length})`);
        }
        
        console.log(`[API] ✅ Identity Verified for: ${address} (Signer: ${sgnrAddr})`);
      } catch (e: any) {
        await client.disconnect();
        return res.status(401).json({ 
          error: e.message || 'Authentication failed',
          version: "2.1.0-hardened"
        });
      }

      // 2. Scan Redis for drops matching this address
      console.log(`[API] 🔍 Scanning for drops matching: dd:${address}:*`);
      const keys = await client.keys(`dd:${address}:*`);
      
      if (keys.length === 0) {
        console.log(`[API] 📭 No drops found for: ${address}`);
        await client.disconnect();
        return res.status(200).json({ drops: [] });
      }

      // 3. Fetch and Delete (Burn-on-Read)
      console.log(`[API] 📥 Found ${keys.length} keys! Fetching and burning...`);
      const drops = [];
      for (const key of keys) {
        const data = await client.get(key);
        if (data) {
          drops.push(JSON.parse(data));
          await client.del(key); // SELF DESTRUCT
        }
      }

      await client.disconnect();
      return res.status(200).json({ drops });
    }

    await client.disconnect();
    res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Dead Drop Error:', error);
    try { await client.disconnect(); } catch { /* ignore */ }
    res.status(500).json({ error: error.message });
  }
}
