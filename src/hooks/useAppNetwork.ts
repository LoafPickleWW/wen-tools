import { NetworkId, useNetwork } from "@txnlab/use-wallet-react";

/**
 * use-wallet v4 moved the active network to useNetwork() and typed it as a plain string
 * (custom networks are allowed). This app only configures the built-in networks, so narrow
 * it back to NetworkId for the helpers that switch on it.
 */
export function useAppNetwork() {
  const { activeNetwork, setActiveNetwork } = useNetwork();
  return { activeNetwork: activeNetwork as NetworkId, setActiveNetwork };
}
