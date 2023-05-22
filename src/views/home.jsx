import algosdk from "algosdk";
import { useState } from "react";
import { toast } from "react-toastify";
import { SelectToolComponent } from "../components/SelectToolComponent";
import { createDonationTransaction } from "../utils";
//import MyAlgoConnect from "@randlabs/myalgo-connect";
import { PeraWalletConnect } from "@perawallet/connect";
import { MAINNET_ALGONODE_NODE } from "../constants";
const peraWallet = new PeraWalletConnect({ shouldShowSignTxnToast: true });

export default function Home() {
  const [donationAmount, setDonationAmount] = useState(10);

  const sendDonation = async () => {
    if (donationAmount < 1) {
      toast.info("Please enter a donation amount greater than 0");
      return;
    } else if (localStorage.getItem("wallet") === null) {
      toast.info("Please connect your wallet first");
      try {
        const accounts = await peraWallet.connect();
        localStorage.setItem("wallet", accounts[0]);
        toast.success("Connected!");
        window.location.reload();
        // const myAlgoConnect = new MyAlgoConnect();
        // const wallet = await myAlgoConnect.connect({
        //     shouldSelectOneAccount: true,
        // });
        // localStorage.setItem("wallet", wallet[0].address);
        // window.location.reload();
      } catch (e) {
        toast.error("Ooops! Something went wrong! Did you allow pop-ups?");
      }
    } else {
      try {
        const group = await createDonationTransaction(donationAmount);
        const algodClient = new algosdk.Algodv2("", MAINNET_ALGONODE_NODE, {
          "User-Agent": "evil-tools",
        });
        toast.info("Sending transaction...");
        const { txId } = await algodClient.sendRawTransaction(group).do();
        await algosdk.waitForConfirmation(algodClient, txId, 3);
        toast.success("Thank you for your donation!");
      } catch (error) {
        toast.error("Error sending donation!");
      }
    }
  };

  return (
    <div className="bg-gray-900 pt-5 pb-24 xl:pb-20 flex justify-center flex-col text-white">
      <main className="flex flex-col justify-center items-center  mx-4 md:mx-40  rounded-lg">
        <SelectToolComponent />
      </main>
      <div className="flex flex-col mx-auto mt-4 items-center gap-1 pt-2 pb-3 rounded-2xl border-secondary-green border-2 w-[16rem]">
        <p className="text-center text-lg">Donate</p>
        <input
          className="border-secondary-green border-2 rounded-xl text-secondary-green text-center font-semibold transition max-w-[8rem] placeholder:text-center placeholder:text-secondary-green/50"
          placeholder="ALGO amount"
          type="number"
          value={donationAmount}
          min={1}
          onChange={(e) => setDonationAmount(parseInt(e.target.value))}
          inputMode="numeric"
        />
        <button
          className="bg-secondary-green/50 px-6 py-1 mt-1 rounded-lg hover:bg-secondary-green/50 transition"
          onClick={sendDonation}
        >
          Send
        </button>
      </div>
      <p className="font-bold text-slate-300 text-xs mt-1 text-center">
        supported by{" "}
        <a
          className="text-green-300/50 hover:text-green-500/50 transition"
          href="https://www.algoverify.me"
          target="_blank"
          rel="noopener noreferrer"
        >
          AlgoVerify
        </a>
      </p>
    </div>
  );
}
