import { useState, useEffect } from "react";
import { useWallet, NetworkId } from "@txnlab/use-wallet-react";
import algosdk from "algosdk";
import { IoClose, IoPlay, IoCheckmarkCircle, IoAlertCircle, IoTerminal, IoHelpCircle } from "react-icons/io5";
import { walletSign } from "../../utils";
import type { AgentListing } from "../../types/agent";

interface TestAgentModalProps {
  open: boolean;
  onClose: () => void;
  listing: AgentListing | null;
  network: NetworkId;
}

type TestStep = "idle" | "pinging" | "signing" | "submitting" | "success" | "error";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function TestAgentModal({ open, onClose, listing, network }: TestAgentModalProps) {
  const { activeAddress, transactionSigner } = useWallet();
  const [step, setStep] = useState<TestStep>("idle");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [payloadText, setPayloadText] = useState(
    JSON.stringify({ message: "Hello from the wen.tools agent test panel!" }, null, 2)
  );
  const [statusMessage, setStatusMessage] = useState("");
  const [errorDetails, setErrorDetails] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [endpointUrl, setEndpointUrl] = useState("");

  useEffect(() => {
    if (listing) {
      setEndpointUrl(listing.endpointUrl);
    }
  }, [listing]);

  if (!open || !listing) return null;

  const handleRunTest = async () => {
    if (!activeAddress) {
      setStep("error");
      setErrorDetails("Please connect your wallet to wen.tools before executing a test call.");
      return;
    }

    setStep("pinging");
    setStatusMessage("Pinging agent endpoint to retrieve x402 payment challenge...");
    setErrorDetails("");
    setTestResult(null);

    const isTestnet = network === NetworkId.TESTNET;
    const algodUrl = isTestnet
      ? "https://testnet-api.4160.nodely.dev"
      : "https://mainnet-api.4160.nodely.dev";
    const algod = new algosdk.Algodv2("", algodUrl, "");

    try {
      // 1. Initial Call (probe for 402 challenge)
      let initialPayload: any = null;
      if (method === "POST") {
        try {
          initialPayload = JSON.parse(payloadText);
        } catch {
          // Fallback to raw text or leave null
        }
      }

      const pingRes = await fetch("/api/test-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointUrl: endpointUrl,
          method: method,
          body: initialPayload,
        }),
      });

      // If already 200/free, show success immediately
      if (pingRes.status === 200 || pingRes.status === 201) {
        const data = await pingRes.json().catch(() => ({}));
        setTestResult({
          status: "free_success",
          message: "Endpoint did not request payment and returned successfully.",
          response: data,
        });
        setStep("success");
        return;
      }

      // Check for 402 Payment Required
      if (pingRes.status !== 402) {
        throw new Error(`Endpoint returned unexpected status ${pingRes.status}`);
      }

      setStatusMessage("x402 payment challenge received. Parsing requirements...");

      // 2. Parse Challenge Details
      const paymentRequiredHeader = pingRes.headers.get("payment-required") || pingRes.headers.get("PAYMENT-REQUIRED");
      let challengeDetails: any = null;

      if (paymentRequiredHeader) {
        try {
          challengeDetails = JSON.parse(atob(paymentRequiredHeader));
        } catch (e) {
          console.error("Failed to parse payment-required base64 header:", e);
        }
      }

      // Fallback: parse body if header is empty or invalid
      if (!challengeDetails) {
        const bodyJson = await pingRes.json().catch(() => ({}));
        challengeDetails = bodyJson.payment_details;
      }

      if (!challengeDetails || !challengeDetails.accepts || challengeDetails.accepts.length === 0) {
        throw new Error("Target endpoint failed to provide valid x402 payment requirements.");
      }

      // Filter accepted options by active network: prefer ALGO (asset ID "0")
      const networkOptions = challengeDetails.accepts.filter((a: any) => {
        const netStr = String(a.network).toLowerCase();
        if (isTestnet) {
          return netStr.includes("testnet") || netStr.includes("sgo1");
        } else {
          return netStr.includes("mainnet") || netStr.includes("wghe2");
        }
      });

      if (networkOptions.length === 0) {
        throw new Error(`Target endpoint does not support payments on ${isTestnet ? "Testnet" : "Mainnet"}.`);
      }

      const getAssetId = (a: any) => {
        if (a.price && typeof a.price === "object" && "asset" in a.price) return String(a.price.asset);
        if (a.asset !== undefined) return String(a.asset);
        return "0";
      };

      const getAmount = (a: any) => {
        if (a.price && typeof a.price === "object" && "amount" in a.price) return String(a.price.amount);
        if (a.price !== undefined && typeof a.price !== "object") return String(a.price);
        if (a.amount !== undefined) return String(a.amount);
        return "0";
      };

      // Prefer USDC (non-zero asset) — the GoPlausible facilitator's exact AVM scheme
      // expects asset transfer transactions; native ALGO pay txns get rejected.
      const acceptedOption = networkOptions.find((a: any) => getAssetId(a) !== "0") || networkOptions[0];
      const amountMicro = Number(getAmount(acceptedOption));
      const recipient = acceptedOption.payTo;
      const assetId = Number(getAssetId(acceptedOption));

      const assetLabel = assetId === 0 ? "ALGO" : "USDC";
      setStatusMessage(`Constructing ${assetLabel} payment transaction...`);
      setStep("signing");

      // 3. Create & Sign Payment Transaction
      const params = await algod.getTransactionParams().do();
      let txn: algosdk.Transaction;

      if (assetId === 0) {
        txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: recipient,
          amount: amountMicro,
          suggestedParams: params,
        });
      } else {
        txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: activeAddress,
          to: recipient,
          amount: amountMicro,
          assetIndex: assetId,
          suggestedParams: params,
        });
      }

      setStatusMessage("Awaiting wallet signature...");
      const signedTxns = await walletSign([txn], transactionSigner);
      
      if (!signedTxns || signedTxns.length === 0) {
        throw new Error("User cancelled the transaction signature.");
      }

      setStatusMessage("Encoding payment signature...");
      setStep("submitting");

      const signedTxnB64 = bytesToBase64(signedTxns[0]);

      // Build PaymentPayload envelope
      const paymentPayload = {
        x402Version: challengeDetails.x402Version || 1,
        payload: {
          paymentGroup: [signedTxnB64],
          paymentIndex: 0,
        },
        ...(challengeDetails.x402Version === 2 ? {
          accepted: acceptedOption,
          resource: challengeDetails.resource || { url: endpointUrl },
          extensions: challengeDetails.extensions || {},
        } : {}),
      };

      const paymentHeader = bytesToBase64(new TextEncoder().encode(JSON.stringify(paymentPayload)));

      // 4. Submit Payment Call
      setStatusMessage("Submitting payment payload and verifying settlement...");
      const verifyRes = await fetch("/api/test-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpointUrl: endpointUrl,
          method: method,
          headers: {
            "X-Payment": paymentHeader,
            "PAYMENT-SIGNATURE": paymentHeader,
          },
          body: initialPayload,
        }),
      });

      const responseBody = await verifyRes.json().catch(async () => {
        return { raw: await verifyRes.text().catch(() => "") };
      });

      if (verifyRes.status === 200 || verifyRes.status === 201) {
        setTestResult(responseBody);
        setStep("success");
      } else {
        let errorMessage = responseBody.message || responseBody.error || `Verification failed with status ${verifyRes.status}`;
        
        // If it's a 402, try to get the real error from the payment-required header
        if (verifyRes.status === 402) {
          const prHeader = verifyRes.headers.get("payment-required") || verifyRes.headers.get("PAYMENT-REQUIRED");
          if (prHeader) {
            try {
              const decoded = JSON.parse(atob(prHeader));
              if (decoded.error) {
                errorMessage = decoded.error;
              }
            } catch (e) {
              // Ignore parsing errors, keep fallback message
            }
          }
        }
        
        throw new Error(errorMessage);
      }
    } catch (err: any) {
      console.error("Test execution failed:", err);
      setStep("error");
      setErrorDetails(err.message || "An unexpected error occurred during testing.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-3xl overflow-hidden shadow-2xl animate-fadeIn my-8">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-800 bg-neutral-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/10 rounded-xl">
              <IoTerminal className="text-xl text-orange-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Execute Agent Test Call</h2>
              <p className="text-xs text-neutral-500 font-mono mt-0.5">{listing.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
          >
            <IoClose className="text-2xl" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 bg-neutral-950 p-4 rounded-2xl border border-neutral-800/50 text-xs">
            <div>
              <span className="text-neutral-500 block uppercase tracking-wider font-bold mb-1">Target Endpoint</span>
              <input
                type="text"
                value={endpointUrl}
                onChange={(e) => setEndpointUrl(e.target.value)}
                className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-2 py-1 mt-0.5 font-mono text-xs text-neutral-300 focus:outline-none focus:border-orange-500 transition-all"
                disabled={step !== "idle"}
              />
            </div>
            <div>
              <span className="text-neutral-500 block uppercase tracking-wider font-bold mb-1">Network &amp; Cost</span>
              <span className="text-neutral-300 font-bold uppercase block mt-1">
                {network === NetworkId.TESTNET ? "Testnet" : "Mainnet"}
              </span>
              <span className="text-orange-400 font-bold">
                {listing.pricePerCallAlgo === 0 ? "FREE" : `${listing.pricePerCallAlgo} USDC / call`}
              </span>
            </div>
          </div>

          {step === "idle" && (
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-bold text-neutral-300">HTTP Request Method</label>
                <div className="flex gap-2 bg-neutral-950 p-1.5 rounded-xl border border-neutral-800 w-fit">
                  <button
                    type="button"
                    onClick={() => setMethod("GET")}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${
                      method === "GET"
                        ? "bg-orange-500 text-black shadow font-black"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    GET
                  </button>
                  <button
                    type="button"
                    onClick={() => setMethod("POST")}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${
                      method === "POST"
                        ? "bg-orange-500 text-black shadow font-black"
                        : "text-neutral-400 hover:text-white"
                    }`}
                  >
                    POST
                  </button>
                </div>
              </div>

              {method === "POST" && (
                <div className="space-y-2 animate-fadeIn">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-bold text-neutral-300">Request Payload (JSON)</label>
                    <span className="text-[10px] text-neutral-500">Optional POST body arguments</span>
                  </div>
                  <textarea
                    value={payloadText}
                    onChange={(e) => setPayloadText(e.target.value)}
                    rows={4}
                    className="w-full bg-neutral-950 border border-neutral-800 focus:border-orange-500 rounded-xl p-3 font-mono text-sm text-neutral-300 focus:outline-none transition-all"
                    placeholder="{}"
                  />
                </div>
              )}
              
              <div className="bg-orange-500/5 border border-orange-500/10 rounded-xl p-4 flex gap-3 text-xs text-orange-300/80 leading-relaxed">
                <IoHelpCircle className="text-lg flex-shrink-0 text-orange-400 mt-0.5" />
                <div>
                  <p className="font-bold text-orange-400">How the test works:</p>
                  <p className="mt-1">
                    First, we query the agent endpoint. If it requires payment under the <strong>x402 standard</strong>, we catch the payment challenge, build a matching transaction, and prompt your connected wallet for signing. Finally, we submit the signature to unlock the agent's response and trigger the refund loop.
                  </p>
                </div>
              </div>

              <button
                onClick={handleRunTest}
                className="w-full flex items-center justify-center gap-2 py-3 bg-orange-500 hover:bg-orange-600 text-black font-black rounded-xl transition-all shadow-lg shadow-orange-500/20 uppercase tracking-wider text-sm"
              >
                <IoPlay />
                Start Test Call
              </button>
            </div>
          )}

          {/* Stepper Status Indicators */}
          {(step === "pinging" || step === "signing" || step === "submitting") && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
              <div className="relative w-12 h-12 flex items-center justify-center">
                <div className="absolute inset-0 border-4 border-orange-500/20 rounded-full" />
                <div className="absolute inset-0 border-4 border-t-orange-500 rounded-full animate-spin" />
              </div>
              <div>
                <h3 className="font-bold text-white text-lg capitalize">{step} Mode</h3>
                <p className="text-sm text-neutral-400 mt-1 max-w-sm">{statusMessage}</p>
              </div>
            </div>
          )}

          {/* Success Result Container */}
          {step === "success" && testResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-400 font-bold">
                <IoCheckmarkCircle className="text-2xl" />
                <span>Test Completed Successfully!</span>
              </div>

              <div className="bg-neutral-950 p-4 rounded-2xl border border-neutral-800 text-xs space-y-2">
                <div className="flex justify-between border-b border-neutral-900 pb-2">
                  <span className="text-neutral-500">HTTP Status</span>
                  <span className="text-green-400 font-bold font-mono">200 OK</span>
                </div>
                
                {testResult.echo && (
                  <>
                    <div className="flex justify-between border-b border-neutral-900 pb-2">
                      <span className="text-neutral-500">Settle Transaction ID</span>
                      <span className="text-neutral-300 font-mono">
                        {testResult.echo.tx_id ? (
                          <a
                            href={`https://${network === NetworkId.TESTNET ? "testnet." : ""}explorer.perawallet.app/tx/${testResult.echo.tx_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-orange-400 hover:underline"
                          >
                            {testResult.echo.tx_id.slice(0, 10)}...{testResult.echo.tx_id.slice(-6)}
                          </a>
                        ) : "N/A"}
                      </span>
                    </div>

                    {testResult.refund && (
                      <div className="flex justify-between border-b border-neutral-900 pb-2">
                        <span className="text-neutral-500">Refund Transaction ID</span>
                        <span className="text-neutral-300 font-mono">
                          {testResult.refund.refund_tx_id ? (
                            <a
                              href={`https://${network === NetworkId.TESTNET ? "testnet." : ""}explorer.perawallet.app/tx/${testResult.refund.refund_tx_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-orange-400 hover:underline"
                            >
                              {testResult.refund.refund_tx_id.slice(0, 10)}...{testResult.refund.refund_tx_id.slice(-6)}
                            </a>
                          ) : (
                            <span className="text-red-400">Failed / Pending</span>
                          )}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="text-xs font-bold text-neutral-500 block uppercase tracking-wider mb-2">Response JSON Payload</label>
                <pre className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 font-mono text-xs text-neutral-300 overflow-x-auto max-h-60 leading-relaxed">
                  {JSON.stringify(testResult, null, 2)}
                </pre>
              </div>

              {testResult.refund && testResult.refund.note && (
                <div className="bg-green-500/10 border border-green-500/20 text-green-300 rounded-xl p-4 text-xs font-medium">
                  {testResult.refund.note}
                </div>
              )}

              <button
                onClick={() => setStep("idle")}
                className="w-full py-3 bg-neutral-800 hover:bg-neutral-700 text-white font-bold rounded-xl transition-colors uppercase tracking-wider text-sm"
              >
                Reset Test Call
              </button>
            </div>
          )}

          {/* Error Container */}
          {step === "error" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-red-400 font-bold">
                <IoAlertCircle className="text-2xl" />
                <span>Test Failed</span>
              </div>
              <p className="text-sm text-neutral-400 leading-relaxed bg-neutral-950 p-4 rounded-xl border border-neutral-800 font-mono text-red-300">
                {errorDetails}
              </p>
              
              <button
                onClick={() => setStep("idle")}
                className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-black font-black rounded-xl transition-colors uppercase tracking-wider text-sm"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
