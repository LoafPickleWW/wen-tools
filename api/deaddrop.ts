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
        const sgnr = decodedTxn.sgnr ? algosdk.encodeAddress(decodedTxn.sgnr) : algosdk.encodeAddress(decodedTxn.txn.from.publicKey);
        
        // Verify signature is mathematically valid
        const rawTxn = decodedTxn.txn;
        const validSig = algosdk.verifyBytes(rawTxn.bytesToSign(), decodedTxn.sig!, sgnr);
        if (!validSig) throw new Error('Signature invalid');

        // Verify Authority (Handle Rekeying)
        const indexerUrl = process.env.VITE_NETWORK === 'testnet' 
          ? 'https://testnet-idx.algonode.cloud' 
          : 'https://mainnet-idx.algonode.cloud';
          
        const accountInfo = await fetch(`${indexerUrl}/v2/accounts/${address}`).then(r => r.json());
        const authorizedSigner = accountInfo.account['auth-addr'] || address;

        if (sgnr !== authorizedSigner) {
          throw new Error('Signer is not authorized for this account');
        }
      } catch (e: any) {
        await client.disconnect();
        return res.status(401).json({ error: e.message || 'Authentication failed' });
      }

      // 2. Scan Redis for drops matching this address
      const keys = await client.keys(`dd:${address}:*`);
      if (keys.length === 0) {
        await client.disconnect();
        return res.status(200).json({ drops: [] });
      }

      // 3. Fetch and Delete (Burn-on-Read)
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
    try { await client.disconnect(); } catch (e) {}
    res.status(500).json({ error: error.message });
  }
}
