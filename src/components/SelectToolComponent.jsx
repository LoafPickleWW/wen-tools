import { Link } from "react-router-dom";

export function SelectToolComponent({ selectTool, setSelectTool }) {
  const tools = [
    {
      id: "collection_data",
      label: "Download Collection Data (CSV)",
      description: "Download all the data for a collection in CSV format",
    },
    {
      id: "collection_snapshot",
      label: "Download Collection Holders (CSV)",
      description: "Download all the holders for a collection in CSV format",
    },
    {
      id: "batch_update",
      label: "Batch Collection Metadata Update",
      description: "Update the metadata for a collection in bulk",
    },
    {
      id: "batch_mint",
      label: "Batch Collection Mint",
      description: "Mint a collection in bulk",
    },
    {
      id: "airdrop_tool",
      label: "Airdrop Tool",
      description: "Airdrop assets to a list of addresses",
    },
    {
      id: "batch_optin",
      label: "Batch Asset Add",
      description: "Optin assets in bulk",
    },
  ];

  return (
    <>
      <p className="text-sm font-medium text-center text-orange-300">
        Select Tool
      </p>
      <div className="flex flex-col space-y-2">
        {tools.map((tool) => (
          <div className="inline-flex items-center space-x-1"
            key={tool.id}
          >
            <input
              id={tool.id}
              type="radio"
              checked={selectTool === tool.id}
              onChange={() => setSelectTool(tool.id)}
              className="rounded-full border-gray-300 text-rose-600 transition focus:ring-rose-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:opacity-75"
            />
            <label
              htmlFor={tool.id}
              className="truncate text-sm font-medium text-slate-200"
            >
              {tool.label}
            </label>
          </div>
        ))}
        <Link
          to="/ipfs-upload"
          className="truncate text-sm font-medium text-slate-300 hover:text-slate-400 transition text-center"
        >
          IPFS Collection Upload
        </Link>
      </div>
    </>
  );
}
