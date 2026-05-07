import { useEffect, useRef } from "react";
import { Card, CardContent, IconButton, Tooltip } from "@mui/material";
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
    <Card variant="outlined">
      <CardContent className="flex flex-col items-center gap-3">
        <h3 className="font-semibold text-base">Fund This Account</h3>
        <p className="text-xs opacity-60 text-center max-w-sm">
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
                className="underline text-blue-500"
              >
                TestNet Faucet
              </a>
              .
            </>
          )}
        </p>

        <div className="bg-white p-2 rounded-lg">
          <canvas ref={canvasRef} />
        </div>

        <div className="flex items-center gap-1 w-full max-w-sm">
          <code className="text-xs bg-black/5 dark:bg-white/10 px-3 py-2 rounded flex-1 font-mono break-all select-all">
            {account.address}
          </code>
          <Tooltip title="Copy address">
            <IconButton size="small" onClick={handleCopy}>
              <IoCopy />
            </IconButton>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}
