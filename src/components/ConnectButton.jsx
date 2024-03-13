import { useEffect, useState } from "react";
import { BiWallet } from "react-icons/bi";
import { ImCross } from "react-icons/im";
import { toast } from "react-toastify";
import { PeraWalletConnect } from "@perawallet/connect";
import { DeflyWalletConnect } from "@blockshake/defly-connect";
import { DaffiWalletConnect } from "@daffiwallet/connect";

const ConnectButton = () => {
  const [walletAddress, setWalletAddress] = useState("");
  const [showConnectPopup, setShowConnectPopup] = useState(false);
  const peraWallet = new PeraWalletConnect();
  const deflyWallet = new DeflyWalletConnect();
  const daffiWallet = new DaffiWalletConnect();

  useEffect(() => {
    const userAddressLocal = localStorage.getItem("wallet");
    if (userAddressLocal) {
      setWalletAddress(userAddressLocal);
    }
  }, []);

  const connectToPera = async () => {
    try {
      const accounts = await peraWallet.connect();
      setWalletAddress(accounts[0]);
      localStorage.setItem("wallet", accounts[0]);
      setShowConnectPopup(false);
      toast.success("Connected!");
      window.location.reload();
    } catch (err) {
      toast.error("Failed to connect!");
    }
  };

  const connectToDefly = async () => {
    try {
      const accounts = await deflyWallet.connect();
      setWalletAddress(accounts[0]);
      localStorage.setItem("wallet", accounts[0]);
      setShowConnectPopup(false);
      toast.success("Connected!");
      window.location.reload();
    } catch (err) {
      toast.error("Failed to connect!");
    }
  };

  const handleDisconnect = async () => {
    try {
      peraWallet.disconnect();
    } catch (error) {
    }
    try {
      deflyWallet.disconnect();
    } catch (error) {
    }
    const networkType = localStorage.getItem("networkType");
    localStorage.clear();
    localStorage.setItem("networkType", networkType);
    setWalletAddress("");
    toast.success("Disconnected!");
    window.location.reload();
  };

  const connectToDaffi = async () => {
    try {
      const accounts = await daffiWallet.connect();
      setWalletAddress(accounts[0]);
      localStorage.setItem("wallet", accounts[0]);
      setShowConnectPopup(false);
      toast.success("Connected!");
      window.location.reload();
    } catch (err) {
      toast.error("Failed to connect!");
    }
  };

  const shortenAddress = (address) => {
    return (
      address.substring(0, 4) + "..." + address.substring(address.length - 4)
    );
  };

  return (
    <>
      {walletAddress === "" ? (
        <>
          <div className="flex flex-col">
            <button
              id="connect-button"
              className="bg-secondary-green rounded-md py-3 px-8 w-fit mx-auto hover:scale-102 font-extrabold text-secondary-black transition"
              onClick={
                walletAddress
                  ? () => handleDisconnect()
                  : () => setShowConnectPopup(true)
              }
            >
              <BiWallet className="w-8 h-8 text-black" />
            </button>
          </div>
        </>
      ) : (
        <button
          className="relative inline-flex items-center overflow-hidden group transition ease-in-out ml-0 bg-primary-green font-semibold text-primary-black
                rounded-md py-2 md:py-3 px-4 md:px-6 w-fit hover:bg-red-500 hover:text-primary-white"
          onClick={handleDisconnect}
        >
          {shortenAddress(walletAddress)}
        </button>
      )}
      {showConnectPopup && (
        <>
          <div
            className={`bg-black fixed top-0 left-0 h-full w-full transition-all ${
              showConnectPopup ? "opacity-50" : "opacity-0"
            }`}
          ></div>
          <div
            className={`fixed top-1/2 left-1/2 bg-primary-green/90 transition-all -translate-x-1/2 -translate-y-[100%] rounded-md ${
              showConnectPopup ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="text-right">
              <button
                className="p-3 text-black"
                onClick={() => setShowConnectPopup(false)}
              >
                <ImCross />
              </button>
            </div>
            <div className="px-5 pb-5 -mt-7">
              <p className="text-xl pb-5 text-center font-semibold text-primary-black">
                Connect Wallet
              </p>
              <div className="flex flex-col justify-center gap-2 text-base">
                <div>
                  <button
                    className="bg-[#ffee55] px-5 py-2 rounded-md w-64 text-black font-semibold hover:scale-95 transition"
                    onClick={connectToPera}
                  >
                    Pera
                  </button>
                </div>
                <div>
                  <button
                    className="bg-[#131313] px-5 py-2 rounded-md w-64 text-white  hover:scale-95 transition"
                    onClick={connectToDefly}
                  >
                    Defly
                  </button>
                </div>
                <div>
                  <button
                    onClick={connectToDaffi}
                    className="bg-[#00BAA4] px-5 py-2 rounded-md w-64 text-black font-semibold  hover:scale-95 transition"
                  >
                    Daffi                
                    </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default ConnectButton;
