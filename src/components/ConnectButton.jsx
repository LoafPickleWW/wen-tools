import { useEffect, useState } from "react";
import MyAlgoConnect from "@randlabs/myalgo-connect";
import { PeraWalletConnect } from "@perawallet/connect";
import { toast } from "react-toastify";

const peraWallet = new PeraWalletConnect();

export default function ConnectButton() {
  const [wallet, setWallet] = useState("");
  const [showConnects, setShowConnects] = useState(false);

  const shortenWallet = (wallet) => {
    return wallet.substring(0, 5) + "..." + wallet.substring(53, 58);
  };

  useEffect(() => {
    const localwallet = localStorage.getItem("wallet");
    if (localwallet != null) {
      setWallet(localwallet);
    }
  }, []);

  const handleClick = () => {
    if (localStorage.getItem("wallet") != null) {
      handleDisconnect();
    } else {
      setShowConnects(true);
    }
  };

  const connectToMyalgo = async () => {
    try {
      const myAlgoConnect = new MyAlgoConnect({ disableLedgerNano: false });
      const settings = {
        shouldSelectOneAccount: true,
        openManager: false,
      };
      const accounts = await myAlgoConnect.connect(settings);
      setWallet(accounts[0].address);
      localStorage.setItem("wallet", accounts[0].address);
      toast.success("Connected!");
      window.location.reload();
    } catch (err) {
      console.log(err);
      //toast.error("Error! Please allow pop-ups!");
    }
  };

  const connectToPera = async () => {
    try {
      const accounts = await peraWallet.connect();
      setWallet(accounts[0]);
      localStorage.setItem("wallet", accounts[0]);
      toast.success("Connected!");
      window.location.reload();
    } catch (err) {
      console.log(err);
      //toast.error("Error! Please allow pop-ups!");
    }
  };

  const handleDisconnect = async () => {
    if (localStorage.getItem("PeraWallet.Wallet") != "null") {
      disconnectPera();
    } else {
      localStorage.removeItem("wallet");
      setWallet("");
      toast.success("Disconnected!");
    }
    window.location.reload();
  };

  function disconnectPera() {
    peraWallet.disconnect();
    localStorage.removeItem("wallet");
    setWallet("");
  }

  if (wallet == "") {
    return (
      <div className="flex flex-col items-center">
        <button
          onClick={handleClick}
          className={`bg-rose-600 px-6 py-2 text-lg sm:text-xl font-bold text-slate-50 hover:text-slate-100 hover:bg-rose-700 shadow-md hover:shadow-none transition-all rounded ${
            showConnects && "hidden"
          }`}
        >
          Connect
        </button>
        <div
          className={`flex flex-col items-center space-y-2  ${
            !showConnects && "hidden"
          }`}
        >
          <button
            onClick={connectToPera}
            className="bg-yellow-300 px-6 py-2 text-lg sm:text-xl font-bold text-black hover:bg-yellow-400 hover:scale-105 
      ease-in-out duration-700 hover:shadow-none rounded font-roboto"
          >
            Pera
          </button>
          <button
            onClick={connectToMyalgo}
            className="bg-blue-600 px-6 py-2 text-base sm:text-base font-bold text-white hover:bg-red-700 hover:scale-100 ease-in-out duration-700 hover:shadow-none rounded font-roboto hover:grayscale"
          >
            MyAlgo <br />
            (use only emergency)
          </button>
        </div>
      </div>
    );
  } else {
    return (
      <div>
        <button
          onClick={handleClick}
          className="bg-red-600 px-6 py-2 text-base sm:text-lg font-bold text-white hover:bg-red-700 hover:scale-95 
      ease-in-out duration-700 hover:shadow-none rounded font-roboto"
        >
          Disconnect
        </button>
        <p className="text-red-300 font-bold text-sm my-2 font-roboto">
          <a
            className="hover:text-red-400 font-roboto transition"
            href={"https://algoexplorer.io/address/" + wallet}
            target="_blank"
          >
            {shortenWallet(wallet)}
          </a>
        </p>
      </div>
    );
  }
}
