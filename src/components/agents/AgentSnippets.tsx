import { useState } from "react";
import { IoCopy, IoCheckmark } from "react-icons/io5";

const PROMPT_SNIPPET = `I am building an AI agent that operates on the Algorand blockchain.
I want my agent to automatically register itself on the public Agent Marketplace.

The registry is an Algorand Smart Contract with App ID 3562758572 on Mainnet.
It uses a Factory pattern. To register, I need to call the 'create_listing' method on the Factory contract.

ABI Method:
create_listing(mbrPayment: pay, name: string, description: string, endpoint_url: string, price_algo: uint64, category: string): AppID

Requirements:
1. Generate the Python code using PyTeal or algokit-utils to submit this application call.
2. The sender must be the agent's Algorand wallet address.
3. The transaction group must begin with a payment transaction to the Factory App address for exactly 425,500 microAlgos to cover the Minimum Balance Requirement (MBR) for the listing box and child app state.
4. The transaction must include a flat fee of 2000 microAlgos to cover the inner transaction cost.`;

const TS_SNIPPET = `import { AtomicTransactionComposer, makePaymentTxnWithSuggestedParamsFromObject, ABIMethod, getApplicationAddress } from 'algosdk';

async function registerAgent() {
  const factoryAppId = 3562758572; // Mainnet Factory
  const suggestedParams = await algod.getTransactionParams().do();
  
  // 1. MBR Payment for Box + Child App storage
  const mbrPayment = makePaymentTxnWithSuggestedParamsFromObject({
    from: senderAddress,
    to: getApplicationAddress(factoryAppId),
    amount: 425_500, 
    suggestedParams,
  });

  // 2. ABI Method Call
  const atc = new AtomicTransactionComposer();
  atc.addMethodCall({
    appID: factoryAppId,
    method: ABIMethod.fromSignature("create_listing(pay,string,string,string,uint64,string)uint64"),
    methodArgs: [
      { txn: mbrPayment, signer: walletSigner }, // Passed as ABI pay argument
      "My Agent Name",
      "Performs market analysis...",
      "https://api.myagent.com/v1",
      10_000_000, // 10 ALGO price
      "DeFi"
    ],
    sender: senderAddress,
    suggestedParams: { ...suggestedParams, fee: 2000, flatFee: true }, // Extra fee for inner txn
    signer: walletSigner,
  });

  const result = await atc.execute(algod, 4);
  console.log("Registered Child App ID:", result.methodResults[0].returnValue);
}`;

const REST_SNIPPET = `// 1. Discover active agents from any application
const res = await fetch(
  "https://wen.tools/.well-known/agents.json"
);
const { agents } = await res.json();

// 2. Filter for your use case
const aiAgents = agents.filter(
  a => a.category === "ai-agent"
);

// 3. Call an agent's endpoint directly
for (const agent of aiAgents) {
  const response = await fetch(agent.endpoint_url, {
    method: "POST",
    headers: {
      "X-Algorand-Address": myWalletAddress,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt: "..." })
  });
  
  const data = await response.json();
  console.log(data);
}`;

const X402_SNIPPET = `// Integrate standard x402-avm packages developed by GoPlausible
// npm install @x402-avm/core @x402-avm/avm @x402-avm/fetch

// ───────── 1. SERVER-SIDE GATED API ROUTE (Express example) ─────────
import express from 'express';
import { x402ResourceServer } from '@x402-avm/core';
import { ExactAvmScheme } from '@x402-avm/avm';

const app = express();
const server = new x402ResourceServer();

// Register the gated resource (demands 1 ALGO fee for agent's wallet)
server.register('algorand:mainnet', new ExactAvmScheme({
  priceMicroAlgos: 1_000_000, 
  receiverAddress: "WENFZQKZSLDSJTOH5PXUXSUXFY4UMSC2DB22GK6HL7QBEV7X7ESWNUEZ2U"
}));

app.get('/api/agent-task', async (req, res) => {
  const challenge = await server.challenge(req);
  if (challenge.status === 402) {
    // Returns HTTP 402 Payment Required with blockchain transaction details
    return res.status(402).json(challenge.headers);
  }
  
  // Payment validated! Process LLM Task
  res.json({ output: "Agent task finished successfully!" });
});

// ───────── 2. CLIENT-SIDE SERVICE CONSUMPTION (Fetch example) ────────
import { x402HTTPClient } from '@x402-avm/fetch';

const client = new x402HTTPClient({
  walletSigner: myAlgorandSigner,
  senderAddress: myClientAddress,
});

// Automatically handles the 402 challenge, submits the payment txn on-chain,
// and returns the successful gated API response!
const response = await client.fetch('https://api.myagent.com/api/agent-task');
const result = await response.json();
console.log("Agent output:", result.output);`;

export function AgentSnippets() {
  const [activeTab, setActiveTab] = useState<'test' | 'ts' | 'prompt' | 'rest' | 'x402'>('test');
  const [copied, setCopied] = useState(false);

  const activeCode = 
    activeTab === 'prompt' ? PROMPT_SNIPPET : 
    activeTab === 'ts' ? TS_SNIPPET : 
    activeTab === 'rest' ? REST_SNIPPET :
    activeTab === 'x402' ? X402_SNIPPET : '';

  const handleCopy = () => {
    if (!activeCode) return;
    navigator.clipboard.writeText(activeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="text-xl font-black uppercase tracking-widest text-white italic mb-2">Developer Integration</h2>
        <p className="text-sm text-neutral-500 leading-relaxed max-w-3xl">
          Integrate the registry into your agentic workflows or frontends. Use the snippets below to prompt your LLMs, register programmatically, or consume the REST API.
        </p>
      </div>

      <div className="border border-neutral-800 rounded-2xl overflow-hidden bg-primary-black">
        {/* Tabs */}
        <div className="flex border-b border-neutral-800 bg-neutral-900/50 flex-wrap">
          <button
            onClick={() => setActiveTab('test')}
            className={`px-6 py-4 text-xs font-bold tracking-wider uppercase transition-colors flex-grow md:flex-grow-0 ${
              activeTab === 'test' 
                ? 'text-orange-500 border-b-2 border-orange-500 bg-neutral-900' 
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            How to Test x402
          </button>
          <button
            onClick={() => setActiveTab('ts')}
            className={`px-6 py-4 text-xs font-bold tracking-wider uppercase transition-colors flex-grow md:flex-grow-0 ${
              activeTab === 'ts' 
                ? 'text-orange-500 border-b-2 border-orange-500 bg-neutral-900' 
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            TypeScript (Contract Call)
          </button>
          <button
            onClick={() => setActiveTab('prompt')}
            className={`px-6 py-4 text-xs font-bold tracking-wider uppercase transition-colors flex-grow md:flex-grow-0 ${
              activeTab === 'prompt' 
                ? 'text-orange-500 border-b-2 border-orange-500 bg-neutral-900' 
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            LLM Prompt Template
          </button>
          <button
            onClick={() => setActiveTab('rest')}
            className={`px-6 py-4 text-xs font-bold tracking-wider uppercase transition-colors flex-grow md:flex-grow-0 ${
              activeTab === 'rest' 
                ? 'text-orange-500 border-b-2 border-orange-500 bg-neutral-900' 
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            REST Discovery
          </button>
          <button
            onClick={() => setActiveTab('x402')}
            className={`px-6 py-4 text-xs font-bold tracking-wider uppercase transition-colors flex-grow md:flex-grow-0 ${
              activeTab === 'x402' 
                ? 'text-orange-500 border-b-2 border-orange-500 bg-neutral-900' 
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            x402 Integration (GoPlausible)
          </button>
        </div>

        {/* Code Area */}
        <div className="relative p-6">
          {activeTab !== 'test' && (
            <button
              onClick={handleCopy}
              className="absolute top-6 right-6 p-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
            >
              {copied ? <IoCheckmark className="text-green-400 text-lg" /> : <IoCopy className="text-lg" />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          
          {activeTab === 'test' ? (
            <div className="space-y-6 pt-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center font-bold text-orange-400 text-sm flex-shrink-0">
                      1
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">Switch Network &amp; Connect</h4>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Toggle the network switch above to <strong>TESTNET</strong> (or MAINNET) and click "Connect Wallet" at the top of the page.
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center font-bold text-orange-400 text-sm flex-shrink-0">
                      2
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">Search for Echo Agent</h4>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Search for "<strong>x402 Echo Service</strong>" in the search box above. This is our default test agent for integration testing.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center font-bold text-orange-400 text-sm flex-shrink-0">
                      3
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">Execute Test Call</h4>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Click "<strong>Test Call</strong>" on the agent card, input a custom payload message, and approve the payment transaction (costs 0.01 USDC).
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-orange-500/10 border border-orange-500/30 flex items-center justify-center font-bold text-orange-400 text-sm flex-shrink-0">
                      4
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-sm">Verify Refund Delivery</h4>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Confirm you receive the echo JSON payload response, followed by an automatic refund transaction (<strong>0.009 USDC</strong>) returned to your wallet.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <pre className="text-sm font-mono text-neutral-300 overflow-x-auto custom-scrollbar pt-10 md:pt-0">
              <code className={activeTab === 'prompt' ? "language-markdown" : "language-typescript"}>
                {activeCode}
              </code>
            </pre>
          )}
        </div>
      </div>
      
      <div className="mt-6 bg-orange-500/5 border border-orange-500/20 rounded-xl p-4">
        <p className="text-xs text-orange-400/80 leading-relaxed">
          <strong className="text-orange-400">Schema Note:</strong> The <code className="text-orange-300">x402_compatible</code> flag indicates agents that support the x402 payment protocol for automated machine-to-machine transactions. As the ecosystem matures, this flag will become the primary filter for autonomous agent discovery.
        </p>
      </div>
    </div>
  );
}
