import { useEffect, useRef } from "react";
import { IoCopy } from "react-icons/io5";
import QRCode from "qrcode";
import { toast } from "react-toastify";
import type { FalconAccount } from "../../utils/falcon";

interface Props {
  account: FalconAccount;
}

export default function FundAccountPanel({ account }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, account.address, {
        width: 180,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
    }
  }, [account.address]);

  const handleCopy = () => {
    navigator.clipboard.writeText(account.address);
    toast.success("Address copied!");
  };

  return (
    <div className="border border-slate-800 rounded-2xl p-6 bg-primary-black/40 flex flex-col items-center gap-4">
      <h3 className="font-bold text-base text-white">Fund This Account</h3>
      <p className="text-xs text-slate-500 text-center max-w-sm">
        Send Algo to this address from Pera, Defly, or any Algorand wallet.
        It's a standard Algorand address — anyone can send to it.
        {account.network === "testnet" && (
          <>
            {" "}
            Or use the{" "}
            <a
              href="https://bank.testnet.algorand.network/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary-yellow hover:text-primary-orange transition"
            >
              TestNet Faucet
            </a>
            .
          </>
        )}
      </p>

      <div className="bg-white p-2 rounded-xl">
        <canvas ref={canvasRef} />
      </div>

      <div className="flex items-center gap-1.5 w-full max-w-sm">
        <code className="text-xs bg-slate-800 px-3 py-2 rounded-lg flex-1 font-mono break-all select-all text-slate-400">
          {account.address}
        </code>
        <button
          onClick={handleCopy}
          title="Copy address"
          className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition"
        >
          <IoCopy />
        </button>
      </div>
    </div>
  );
}
