import { useState, useCallback, useRef } from "react";
import { useWallet } from "@txnlab/use-wallet-react";
import axios from "axios";
import { getIndexerURL, getNfDomainsInBulk } from "../../utils";
import { GraphNode, GraphEdge } from "../../types/analytics";

// Common Algorand AMMs / System wallets to filter out
const SYSTEM_WALLETS = new Set([
  "MAINSWAPUWNZ6TMR2HXB3VGL2FQLT5P4PMRQ4GELPH4O4W3T2J2QFE4A", // CEX or similar
  "FALCON4WQDWT7F5NRY37G3H3A3Q4LMRY37G3H3A3Q4LMRY37G3H3A3Q", // Falcon signatures/rewards/fees
  "NFDNL7Q3PXEZ7A6G4A7V2D3V4XEZ7A6G4A7V2D3V4XEZ7A6G4A7V2D3", // NFD Registry
  "TINYMANV11GOVJVSOCDTANOTCHOPPHSVSOCDTANOTCHOPPHSVSO",       // Tinyman v1.1
  "TINYMANV2ERB2N3Q4V5W6X7Y8Z1A2B3C4D5E6F7G8H9I0J1K2L3M",    // Tinyman v2
  "Pact AMM / DEX addresses",                                 // Representational
]);

export interface UseClusterDataOptions {
  limit: number;
  excludeSystem: boolean;
}

export function useClusterData() {
  const { activeNetwork } = useWallet();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Address -> array of transactions cache
  const transactionCache = useRef<Record<string, any[]>>({});
  // Address -> NFD cache
  const nfdCache = useRef<Record<string, string>>({});
  // Seed addresses tracking
  const seedAddresses = useRef<Set<string>>(new Set());
  // First bonded addresses mapping (seed -> bonded)
  const firstBondedMap = useRef<Record<string, string>>({});

  const reset = useCallback(() => {
    setNodes([]);
    setEdges([]);
    setError(null);
    transactionCache.current = {};
    nfdCache.current = {};
    seedAddresses.current = new Set();
    firstBondedMap.current = {};
  }, []);

  const fetchFirstBonded = async (address: string, indexerUrl: string): Promise<string | null> => {
    try {
      const response = await axios.get(
        `${indexerUrl}/v2/accounts/${address}/transactions?limit=1&order=asc`
      );
      const txns = response.data.transactions;
      if (txns && txns.length > 0) {
        const firstTx = txns[0];
        // The sender or receiver of the first transaction is the counterparty
        if (firstTx.sender !== address) return firstTx.sender;
        const receiver = firstTx["payment-transaction"]?.receiver || 
                         firstTx["asset-transfer-transaction"]?.receiver;
        if (receiver && receiver !== address) return receiver;
      }
    } catch (e) {
      console.error("Error fetching first-bonded transaction:", e);
    }
    return null;
  };

  const processGraph = useCallback(
    async (newAddresses: string[], options: UseClusterDataOptions) => {
      const indexerUrl = getIndexerURL(activeNetwork);
      const allAddressesToFetch = newAddresses.filter(
        (addr) => !transactionCache.current[addr]
      );

      // Fetch transaction history
      for (const addr of allAddressesToFetch) {
        try {
          const res = await axios.get(
            `${indexerUrl}/v2/accounts/${addr}/transactions?limit=${options.limit}`
          );
          transactionCache.current[addr] = res.data.transactions || [];
        } catch (e) {
          console.error(`Failed to fetch transactions for ${addr}`, e);
          transactionCache.current[addr] = [];
        }

        // Fetch first-bonded address for seeds
        if (seedAddresses.current.has(addr) && !firstBondedMap.current[addr]) {
          const bonded = await fetchFirstBonded(addr, indexerUrl);
          if (bonded) {
            firstBondedMap.current[addr] = bonded;
          }
        }
      }

      // Collect all unique addresses present in nodes or counterparties
      const nodeStats: Record<string, { sent: number; recv: number; total: number }> = {};
      const edgeStats: Record<string, number> = {}; // key: "from->to" or "to->from" depending on direction

      // Initialize stats for seed addresses
      seedAddresses.current.forEach((addr) => {
        nodeStats[addr] = { sent: 0, recv: 0, total: 0 };
      });

      // Analyze transactions to build nodes & edges
      Object.keys(transactionCache.current).forEach((address) => {
        const txns = transactionCache.current[address];
        if (!nodeStats[address]) {
          nodeStats[address] = { sent: 0, recv: 0, total: 0 };
        }

        txns.forEach((tx: any) => {
          const sender = tx.sender;
          const receiver =
            tx["payment-transaction"]?.receiver ||
            tx["asset-transfer-transaction"]?.receiver;

          if (!receiver || sender === receiver) return;

          // Exclude system wallets if option enabled
          if (
            options.excludeSystem &&
            (SYSTEM_WALLETS.has(sender) || SYSTEM_WALLETS.has(receiver))
          ) {
            return;
          }

          // Count sender stats
          if (!nodeStats[sender]) nodeStats[sender] = { sent: 0, recv: 0, total: 0 };
          nodeStats[sender].sent++;
          nodeStats[sender].total++;

          // Count receiver stats
          if (!nodeStats[receiver]) nodeStats[receiver] = { sent: 0, recv: 0, total: 0 };
          nodeStats[receiver].recv++;
          nodeStats[receiver].total++;

          // Build edge key consistently
          const edgeKey = sender < receiver ? `${sender}->${receiver}` : `${receiver}->${sender}`;
          edgeStats[edgeKey] = (edgeStats[edgeKey] || 0) + 1;
        });
      });

      // Fetch NFDs in bulk for all resolved accounts
      const allResolvedAddresses = Object.keys(nodeStats);
      const unresolvedNFDAddresses = allResolvedAddresses.filter(
        (addr) => nfdCache.current[addr] === undefined
      );

      if (unresolvedNFDAddresses.length > 0) {
        try {
          const nfdResults = await getNfDomainsInBulk(unresolvedNFDAddresses);
          unresolvedNFDAddresses.forEach((addr) => {
            nfdCache.current[addr] = nfdResults[addr] || "";
          });
        } catch (e) {
          console.error("Error fetching bulk NFDs:", e);
        }
      }

      // Construct Node list
      const firstBondedSet = new Set(Object.values(firstBondedMap.current));

      const finalNodes: GraphNode[] = Object.entries(nodeStats).map(([address, stats]) => {
        const isSeed = seedAddresses.current.has(address);
        const nfd = nfdCache.current[address] || "";
        const label = nfd || `${address.slice(0, 6)}...${address.slice(-6)}`;

        return {
          id: address,
          label,
          val: stats.total,
          type: isSeed ? "seed" : "counterparty",
          isFirstBonded: firstBondedSet.has(address),
          isExpanded: !!transactionCache.current[address],
          sentCount: stats.sent,
          recvCount: stats.recv,
          totalCount: stats.total,
        };
      });

      // Construct Edge list
      const finalEdges: GraphEdge[] = Object.entries(edgeStats).map(([key, count]) => {
        const [left, right] = key.split("->");
        // Determine flow count by reading actual txn directions if cached
        let leftToRightCount = 0;
        let rightToLeftCount = 0;

        // Scan transactions to determine flow directions
        [left, right].forEach((addr) => {
          const txns = transactionCache.current[addr] || [];
          txns.forEach((tx: any) => {
            const sender = tx.sender;
            const receiver =
              tx["payment-transaction"]?.receiver ||
              tx["asset-transfer-transaction"]?.receiver;

            if (sender === left && receiver === right) leftToRightCount++;
            if (sender === right && receiver === left) rightToLeftCount++;
          });
        });

        let source = left;
        let target = right;
        let direction: "forward" | "backward" | "both" = "both";

        if (leftToRightCount > 0 && rightToLeftCount === 0) {
          source = left;
          target = right;
          direction = "forward";
        } else if (rightToLeftCount > 0 && leftToRightCount === 0) {
          source = right;
          target = left;
          direction = "forward";
        }

        return {
          source,
          target,
          count,
          direction,
        };
      });

      setNodes(finalNodes);
      setEdges(finalEdges);
    },
    [activeNetwork]
  );

  const fetchSeedAddresses = useCallback(
    async (addresses: string[], options: UseClusterDataOptions) => {
      setLoading(true);
      setError(null);
      try {
        reset();
        addresses.forEach((addr) => seedAddresses.current.add(addr));
        await processGraph(addresses, options);
      } catch (err: any) {
        setError(err.message || "An error occurred fetching cluster data.");
      } finally {
        setLoading(false);
      }
    },
    [processGraph, reset]
  );

  const expandNode = useCallback(
    async (address: string, options: UseClusterDataOptions) => {
      setLoading(true);
      setError(null);
      try {
        await processGraph([address], options);
      } catch (err: any) {
        setError(err.message || "An error occurred expanding the node.");
      } finally {
        setLoading(false);
      }
    },
    [processGraph]
  );

  return {
    nodes,
    edges,
    loading,
    error,
    fetchSeedAddresses,
    expandNode,
    reset,
  };
}
