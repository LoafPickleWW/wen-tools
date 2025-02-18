import { Link } from "react-router-dom";
import { TOOLS } from "../constants";
import { USAlgo2025Leaderboard } from "./USAlgo2025Leaderboard";
export function SelectToolComponent() {
  return (
    <div className="text-center w-full">
      <div className="mx-auto my-2 md:my-4">
        <div className="flex flex-col lg:flex-row items-center justify-evenly lg:gap-2 gap-4">
          <CarouselComponent
            images={[
              { path: "./wenwallet.png", url: "https://wallet.wen.tools" },
              { path: "./wenswap.png", url: "https://swap.wen.tools" },
            ]}
          />
          <a
            href="https://algoxnft.com/shuffle/2943"
            target="blank"
            className="lg:w-[34%] w-[70%]"
          >
            <img src="/usalgo.gif" alt="" />
          </a>
        </div>
      </div>

      <USAlgo2025Leaderboard />

      <p className="col-span-3 text-start  text-2xl lg:text-4xl font-semibold tracking-tight text-white font-sans py-4">
        asset tools
      </p>
      <div className="container gap-6 cursor-pointer grid lg:grid-cols-3 py-4">
        {TOOLS.filter((tool) => tool.category === "asset").map((tool) => (
          <div className="w-full rounded-[36px] bg-gradient-to-r from-[#E4E808] to-[#FD941D] hover:bg-none p-1">
            <div
              className="flex flex-col items-center justify-center rounded-[36px] border-transparent bg-black gap-3 p-8 w-[100%] h-[100%] text-[#FDFDFD] shadow transition duration-500 ease-in-out hover:text-black hover:bg-gradient-to-r from-[#E4E808] to-[#FD941D] hover:border-2 relative group"
              key={tool.id}
            >
              <Link
                to={tool.path}
                className="transform flex flex-col items-center justify-center duration-300 ease-in-out group-hover:-translate-y-0"
              >
                {/* Faster color change for h5 */}
                <h5 className="text-2xl font-medium transition-colors duration-200 ease-in-out group-hover:text-black">
                  {tool.label}
                </h5>
              </Link>
              {/* Description with height and opacity transition */}
              <p className="font-medium text-center text-black opacity-0 max-h-0 overflow-hidden duration-500 ease-in-out group-hover:opacity-100 group-hover:max-h-20 transition-all">
                {tool.description}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="col-span-3 text-start text-4xl font-semibold tracking-tight text-white font-sans py-4">
        mint tools
      </p>
      <div className="container gap-6 cursor-pointer grid lg:grid-cols-3 py-4">
        {TOOLS.filter((tool) => tool.category === "mint").map((tool) => (
          <div className="w-full rounded-[36px] bg-gradient-to-r from-[#E4E808] to-[#FD941D] hover:bg-none p-1">
            <div
              className="flex flex-col items-center justify-center rounded-[36px] border-transparent bg-black gap-3 p-8 w-[100%] h-[100%] text-[#FDFDFD] shadow transition duration-500 ease-in-out hover:text-black hover:bg-gradient-to-r from-[#E4E808] to-[#FD941D] hover:border-2 relative group"
              key={tool.id}
            >
              <Link
                to={tool.path}
                className="transform flex flex-col items-center justify-center duration-300 ease-in-out group-hover:-translate-y-0"
              >
                {/* Faster color change for h5 */}
                <h5 className="text-2xl font-medium transition-colors duration-200 ease-in-out group-hover:text-black">
                  {tool.label}
                </h5>
              </Link>
              {/* Description with height and opacity transition */}
              <p className="font-medium text-center text-black opacity-0 max-h-0 overflow-hidden duration-500 ease-in-out group-hover:opacity-100 group-hover:max-h-20 transition-all">
                {tool.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
