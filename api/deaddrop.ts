import { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import algosdk from 'algosdk';

/**
 * Dead Drop Relay API
 * Handles encrypted payload storage and signature-verified retrieval.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'POST') {
      const { recipient, payload, nonce, ephemeralPk, expiry } = req.body;
      
      if (!recipient || !payload) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Store in KV with a 24h TTL by default
      const key = `dd:${recipient}:${Date.now()}`;
      await kv.set(key, { payload, nonce, ephemeralPk, recipient }, { ex: expiry || 86400 });
      
      return res.status(200).json({ success: true, id: key });
    }

    if (req.method === 'GET') {
      const { address, sig, txn } = req.query;

      if (!address || !sig || !txn) {
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
        // We check the Indexer to see if this signer is authorized for the target address
        const indexerUrl = process.env.VITE_NETWORK === 'testnet' 
          ? 'https://testnet-idx.algonode.cloud' 
          : 'https://mainnet-idx.algonode.cloud';
          
        const accountInfo = await fetch(`${indexerUrl}/v2/accounts/${address}`).then(r => r.json());
        const authorizedSigner = accountInfo.account['auth-addr'] || address;

        if (sgnr !== authorizedSigner) {
          throw new Error('Signer is not authorized for this account');
        }
      } catch (e: any) {
        return res.status(401).json({ error: e.message || 'Authentication failed' });
      }

      // 2. Scan KV for drops matching this address
      const keys = await kv.keys(`dd:${address}:*`);
      if (keys.length === 0) {
        return res.status(200).json({ drops: [] });
      }

      // 3. Fetch and Delete (Burn-on-Read)
      const drops = [];
      for (const key of keys) {
        const drop = await kv.get(key);
        drops.push(drop);
        await kv.del(key); // SELF DESTRUCT
      }

      return res.status(200).json({ drops });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Dead Drop Error:', error);
    res.status(500).json({ error: error.message });
  }
}
