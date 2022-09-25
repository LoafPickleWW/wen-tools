import { useEffect, useState } from "react";
import MyAlgoConnect from "@randlabs/myalgo-connect";
import { toast } from "react-toastify";

export default function ConnectButton() {
  const [wallet, setWallet] = useState("");

  const shortenWallet = (wallet) => {
    return wallet.substring(0, 5) + "..." + wallet.substring(53, 58);
  };

  useEffect(() => {
    const wallet = localStorage.getItem("wallet");
    if (wallet != null) {
      setWallet(wallet);
    }
  }, []);

  const handleClick = () => {
    if (localStorage.getItem("wallet") != null) {
      window.location.reload();
      localStorage.removeItem("wallet");
      setWallet("");
    } else {
      connectToWallet();
    }
  };

  const connectToWallet = async () => {
    try {
      const myAlgoConnect = new MyAlgoConnect();
      const wallet = await myAlgoConnect.connect({
        shouldSelectOneAccount: true,
      });
      setWallet(wallet[0].address);
      localStorage.setItem("wallet", wallet[0].address);
      window.location.reload();
    } catch (e) {
      toast.error("Ooops! Something went wrong! Did you allow pop-ups?");
    }
  };

  if (wallet == "") {
    return (
      <button
        onClick={handleClick}
        className="bg-green-600 px-6 py-2 text-base sm:text-lg font-bold text-slate-50 hover:text-slate-100 hover:bg-green-700 hover:scale-95 
      ease-in-out duration-700 hover:shadow-none rounded font-roboto"
      >
        Connect
      </button>
    );
  } else {
    return (
      <>
        <button
          onClick={handleClick}
          className="bg-rose-600 px-6 py-2 text-base sm:text-lg font-bold text-slate-50 hover:text-slate-100 hover:bg-rose-700 hover:scale-95 
      ease-in-out duration-700 hover:shadow-none rounded font-roboto"
        >
          Disconnect
        </button>
        <p className="text-slate-300 font-semibold text-sm my-2 font-roboto">
          Address:{" "}
          <a
            className="hover:text-slate-50 font-roboto"
            href={"https://algoexplorer.io/address/" + wallet}
            target="_blank"
          >
            {shortenWallet(wallet)}
          </a>
        </p>
      </>
    );
  }
}
