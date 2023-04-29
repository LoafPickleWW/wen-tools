import { useEffect, useState } from "react";

export default function SelectNetworkComponent() {
  const [selectNetwork, setSelectNetwork] = useState("mainnet");

  const updateNetworkType = (networkType) => {
    localStorage.setItem("networkType", networkType);
    setSelectNetwork(networkType);
  };

  useEffect(() => {
    if (localStorage.getItem("networkType") !== null) {
      updateNetworkType(localStorage.getItem("networkType"));
    } else {
      // default network is mainnet
      updateNetworkType("mainnet");
    }
  }, []);

  return (
    <div className="px-4 py-2 rounded-lg">
      <p className="text-sm font-medium text-center text-primary-green/80">
        Select Network
      </p>
      <div className="inline-flex items-center space-x-2">
        <select
          value={selectNetwork}
          onChange={(e) => updateNetworkType(e.target.value)}
          className="rounded border-gray-300 text-secondary-green transition focus:ring-secondary-green px-2"
        >
          <option value="mainnet">Mainnet</option>
          <option value="testnet">Testnet</option>
        </select>
      </div>
    </div>
  );
}
