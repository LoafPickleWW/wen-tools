import { useState } from "react";
import { toast } from "react-toastify";
import { useClusterData } from "../components/analytics/useClusterData";
import { AddressInput } from "../components/analytics/AddressInput";
import { ClusterGraph } from "../components/analytics/ClusterGraph";
import { NodeInspector } from "../components/analytics/NodeInspector";
import { Meta } from "../components/Meta";
import ConnectButton from "../components/ConnectButton";
import { IoShareSocialOutline, IoDownloadOutline, IoHelpCircleOutline, IoOptionsOutline } from "react-icons/io5";
import { GraphNode } from "../types/analytics";

export function ClusterMap() {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [limit, setLimit] = useState(200);
  const [excludeSystem, setExcludeSystem] = useState(true);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const {
    nodes,
    edges,
    loading,
    fetchSeedAddresses,
    expandNode,
    reset,
  } = useClusterData();

  const handleFetch = async () => {
    if (addresses.length === 0) {
      toast.info("Please add at least one address or NFD to query!");
      return;
    }
    setSelectedNode(null);
    await fetchSeedAddresses(addresses, { limit, excludeSystem });
  };

  const handleNodeExpand = async (address: string) => {
    await expandNode(address, { limit, excludeSystem });
  };

  const downloadCSV = () => {
    if (edges.length === 0) {
      toast.info("No connections to export!");
      return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "from_address,to_address,tx_count,direction\n";

    edges.forEach((edge) => {
      const sourceId = typeof edge.source === "string" ? edge.source : edge.source.id;
      const targetId = typeof edge.target === "string" ? edge.target : edge.target.id;
      csvContent += `"${sourceId}","${targetId}",${edge.count},"${edge.direction}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `wallet-connections-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("CSV exported successfully!");
  };

  const downloadPNG = () => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      toast.error("Canvas element not found!");
      return;
    }
    try {
      const url = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `wallet-cluster-map-${Date.now()}.png`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("PNG exported successfully!");
    } catch {
      toast.error("Failed to export image due to canvas security constraints.");
    }
  };

  return (
    <div className="bg-primary-black pt-4 flex justify-center flex-col text-white min-h-screen">
      <Meta
        title="Wallet Cluster Map"
        description="Visual explorer to investigate connected Algorand wallets, identify bot networks, and trace transaction flows in real-time."
      />

      <article className="mx-auto text-white mb-16 flex flex-col items-center max-w-6xl w-full px-4 gap-8">
        {/* Header Section */}
        <header className="w-full flex flex-col items-center mt-10 text-center">
          <div className="flex items-center gap-3 justify-center">
            <div className="p-2.5 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl shadow-lg shadow-orange-500/20">
              <IoShareSocialOutline className="text-2xl text-black" aria-hidden="true" />
            </div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 bg-clip-text text-transparent py-1 uppercase">
              Cluster Map
            </h1>
          </div>
          <p className="text-slate-400 mt-4 text-sm md:text-base font-medium max-w-xl leading-relaxed">
            Trace relationships and uncover coordinated wallet networks or transaction flows on Algorand.
          </p>
        </header>

        {/* Action Panel */}
        <div className="w-full bg-[#18181c]/90 border border-white/5 rounded-3xl p-6 md:p-8 backdrop-blur-xl shadow-2xl flex flex-col gap-6">
          <div className="flex justify-between items-center flex-wrap gap-4">
            <ConnectButton inmain={true} />
            
            {/* Quick settings toolbar */}
            <div className="flex items-center gap-3 bg-secondary-black/80 border border-secondary-gray px-4 py-2.5 rounded-2xl text-xs">
              <div className="flex items-center gap-2">
                <IoOptionsOutline className="text-amber-400 text-sm" />
                <span className="font-semibold text-slate-300">Tx Limit:</span>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="bg-banner-grey border border-secondary-gray rounded px-1.5 py-0.5 text-white"
                >
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select>
              </div>

              <div className="h-4 w-px bg-secondary-gray/50" />

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={excludeSystem}
                  onChange={(e) => setExcludeSystem(e.target.checked)}
                  className="rounded border-slate-800 text-amber-400 focus:ring-amber-400 bg-slate-950 h-3.5 w-3.5"
                />
                <span className="text-slate-300 select-none">Filter AMMs</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-4">
              <AddressInput onAddressesChange={setAddresses} />

              <div className="flex gap-3">
                <button
                  onClick={handleFetch}
                  disabled={loading || addresses.length === 0}
                  className="flex-1 bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 disabled:opacity-50 text-black font-bold py-3 rounded-xl transition shadow-lg cursor-pointer text-sm"
                >
                  {loading && nodes.length === 0 ? "Loading Data..." : "Generate Cluster Map"}
                </button>
                {nodes.length > 0 && (
                  <button
                    onClick={() => {
                      reset();
                      setSelectedNode(null);
                    }}
                    className="px-5 bg-banner-grey border border-secondary-gray text-slate-300 hover:text-white rounded-xl transition text-sm"
                  >
                    Reset Map
                  </button>
                )}
              </div>
            </div>

            {/* Explanatory Panel */}
            <div className="bg-banner-grey/30 border border-secondary-gray/30 rounded-2xl p-5 text-xs text-slate-400 leading-relaxed flex flex-col gap-3">
              <span className="font-bold text-slate-300 flex items-center gap-1.5">
                <IoHelpCircleOutline className="text-sm text-amber-400" /> Understanding Clusters
              </span>
              <p>
                This visualizer constructs address bonds based on direct transaction flows. Hovering over components reveals metrics and directions.
              </p>
              <p>
                <strong>First-Bonded Indicator:</strong> The wallet that originally sent funding to establish the address balance. Identifying a common source wallet reveals coordinated bot rings instantly.
              </p>
            </div>
          </div>
        </div>

        {/* Visual Graph Section */}
        {nodes.length > 0 && (
          <div className="w-full flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 w-full flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h2 className="text-lg font-bold tracking-tight text-white uppercase">Visual Graph</h2>
                <div className="flex gap-2">
                  <button
                    onClick={downloadPNG}
                    className="flex items-center gap-1.5 bg-banner-grey border border-secondary-gray text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg transition"
                  >
                    <IoDownloadOutline /> PNG
                  </button>
                  <button
                    onClick={downloadCSV}
                    className="flex items-center gap-1.5 bg-banner-grey border border-secondary-gray text-xs text-slate-300 hover:text-white px-3 py-1.5 rounded-lg transition"
                  >
                    <IoDownloadOutline /> CSV
                  </button>
                </div>
              </div>
              <ClusterGraph
                nodes={nodes}
                edges={edges}
                onNodeClick={setSelectedNode}
              />
            </div>

            <div className="w-full lg:w-auto shrink-0 self-stretch">
              <NodeInspector
                node={selectedNode}
                onExpand={handleNodeExpand}
                onClose={() => setSelectedNode(null)}
                loading={loading}
              />
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
export default ClusterMap;
