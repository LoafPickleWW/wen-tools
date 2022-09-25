import { useState } from 'react';
import Papa from 'papaparse';
import ConnectButton from './ConnectButton';

export function BatchCollectionMetadataUpdate() {
    const [csvData, setCsvData] = useState(null);
    const [csvHeaders, setCsvHeaders] = useState(null);
    const [fileSize, setFileSize] = useState(null);

    return (
        <div className='mb-4 text-center flex flex-col items-center max-w-[40rem] gap-y-2'>
            <p>1- Connect Creator Wallet</p>
            <ConnectButton />
            <p>2- Upload CSV file</p>
            <label htmlFor="dropzone-file" className="flex flex-col justify-center items-center w-[16rem] h-[8rem] px-4  rounded-lg border-2  border-dashed cursor-pointer hover:bg-bray-800 bg-gray-700  border-gray-600 hover:border-gray-500 hover:bg-gray-600">
                <div className="flex flex-col justify-center items-center pt-5 pb-6">
                    <p className="mb-1 text-sm text-gray-400 font-bold">Click to upload file</p>
                    <p className="text-xs text-gray-400">(CSV,XLS,XLSX)</p>
                </div>
                <input
                    className="hidden"
                    id="dropzone-file"
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => {
                        const file = e.target.files[0];
                        setFileSize(file.size);
                        Papa.parse(file, {
                            complete: function (results) {
                                setCsvData(results.data);
                                setCsvHeaders(results.data[0]);
                                console.log(results.data[0]);
                                console.log(results.data);
                            },
                        });
                    }}
                />
            </label>

        </div>
    )
}