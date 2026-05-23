import { ToolSelectProps } from "../../types/wallet";
import ToolSelect from "./selects/ToolSelect";

const TopArea = ({ tools, setFilteredAssets }: ToolSelectProps) => {
  return (
    <div className="flex flex-col-reverse md:flex-row justify-between items-center py-2 px-2 gap-y-1">
      <ToolSelect tools={tools} setFilteredAssets={setFilteredAssets} />
    </div>
  );
};

export default TopArea;
