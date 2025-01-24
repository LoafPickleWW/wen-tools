import { JsonView, allExpanded, darkStyles } from "react-json-view-lite";

export const PreviewAssetComponent = ({
  previewAsset,
  imageUrl,
}: {
  previewAsset: any;
  imageUrl: string;
}) => {
  return (
    <div className="flex flex-col mt-2 justify-center items-center w-full bg-secondary-black p-4 rounded-lg">
      <p className="text-lg font-bold">Preview Asset</p>
      <div className="flex flex-col items-center mt-2 w-full">
        {imageUrl != "" && (
          <img
            src={imageUrl}
            alt="preview"
            className="w-32 h-32 object-cover rounded-lg"
          />
        )}
        <p className="text-base text-gray-200 mt-2">
          {previewAsset.asset_name} | {previewAsset.unit_name}
        </p>
        {/* metadata like json intended */}
        <div className="text-sm text-gray-200 mt-1 w-[90%] overflow-y-hidden overflow-x-auto text-left">
          <JsonView
            data={previewAsset.ipfs_data}
            shouldExpandNode={allExpanded}
            style={darkStyles}
          />
        </div>
      </div>
    </div>
  );
};
