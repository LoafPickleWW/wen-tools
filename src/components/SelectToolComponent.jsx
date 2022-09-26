export function SelectToolComponent({ selectTool, setSelectTool }) {
    return (
        <>
            <p className="text-sm font-medium text-center text-orange-300">
                Select Tool
            </p>
            <div className="flex flex-col space-y-2">
                <div className="inline-flex items-center space-x-1">
                    <input
                        id="collection_data"
                        type="radio"
                        checked={selectTool === "collection_data"}
                        onChange={() => setSelectTool("collection_data")}
                        className="rounded-full border-gray-300 text-rose-600 transition focus:ring-rose-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:opacity-75"
                    />
                    <label
                        htmlFor="collection_data"
                        className="truncate text-sm font-medium text-slate-200"
                    >
                        Download Collection Data <span className="italic font-thin">(CSV)</span>
                    </label>
                </div>
                <div className="inline-flex items-center space-x-1">
                    <input
                        id="batch_update"
                        type="radio"
                        checked={selectTool === "batch_update"}
                        onChange={() => setSelectTool("batch_update")}
                        className="rounded-full border-gray-300 text-rose-600 transition focus:ring-rose-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:opacity-75"
                    />
                    <label
                        htmlFor="batch_update"
                        className="truncate text-sm font-medium text-slate-200"
                    >
                        Batch Collection Metadata Update
                    </label>
                </div>
            </div>
        </>
    )
}