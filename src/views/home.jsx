import { useState, useEffect } from "react";
import { BatchCollectionMetadataUpdate } from "../components/BatchMetadataUpdateComponent";
import { DownloadCollectionData } from "../components/DownloadCollectionData";
import { SelectToolComponent } from "../components/SelectToolComponent";

export default function Home() {
    const [selectTool, setSelectTool] = useState("collection_data");

    return (
        <div className="bg-gray-900 text-white  min-h-screen">
            <header className="flex justify-center items-center p-4">
                <h1 className="text-2xl font-bold">Evil Tools <p className="italic font-thin text-center text-xl">(ARC69)</p></h1>
            </header>
            <main className="flex flex-col justify-center items-center bg-gray-800 mx-4 md:mx-64  rounded-lg">
                <fieldset className="space-y-3 my-4 bg-rose-500/50 px-4 py-2 rounded-lg">
                    <SelectToolComponent selectTool={selectTool} setSelectTool={setSelectTool} />
                </fieldset>
                {selectTool === "collection_data" ? (
                    <DownloadCollectionData />
                ) : (
                    <BatchCollectionMetadataUpdate />
                )}
            </main>
        </div>
    );
}
