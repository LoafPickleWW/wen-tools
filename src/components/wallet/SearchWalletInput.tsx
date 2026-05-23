import { isValidAddress } from "algosdk";
import { useState } from "react";
import { FaSearch } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { getWalletAddressFromNfDomain } from "../../utils/wallet";

export default function SearchWalletInput() {
  const [searchWallet, setSearchWallet] = useState("");
  const navigation = useNavigate();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const walletAddress = searchWallet.trim();
    if (walletAddress.toLowerCase().includes(".algo")) {
      const response = await getWalletAddressFromNfDomain(
        walletAddress.toLowerCase()
      );
      if (response.length === 58 && isValidAddress(response)) {
        setSearchWallet("");
        navigation(`/wallet/account/${walletAddress.toLowerCase()}`);
      } else {
        toast.error("Invalid domain name!");
        return;
      }
    } else if (!isValidAddress(walletAddress)) {
      try {
        if (!isNaN(parseInt(walletAddress)) && Number(walletAddress) > 0) {
          setSearchWallet("");
          navigation(`/wallet/asset/${walletAddress}`);
        } else {
          toast.error("Invalid wallet address!");
          return;
        }
      } catch {
        toast.error("Invalid wallet address!");
        return;
      }
    } else {
      setSearchWallet("");
      navigation(`/wallet/account/${walletAddress}`);
    }
  };

  return (
    <form className="flex w-full max-w-lg mx-auto" onSubmit={handleSubmit}>
      <input
        id="wallet-search-input"
        type="text"
        className="px-4 py-2 flex-grow rounded-l placeholder:font-roboto placeholder:text-zinc-500 text-white bg-zinc-800 border border-zinc-700 focus:border-amber-400 focus:outline-none placeholder:opacity-70"
        placeholder="search account, .algo domain, or asset ID"
        value={searchWallet}
        onChange={(e) => setSearchWallet(e.target.value)}
      />
      <button
        type="submit"
        className="flex items-center justify-center rounded-r px-5 bg-secondary-orange hover:bg-opacity-80 transition duration-150"
      >
        <FaSearch className="text-black" />
      </button>
    </form>
  );
}
