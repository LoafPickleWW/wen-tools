import { Link } from "react-router-dom";
import { TOOLS } from "../constants";
import { USAlgo2025Leaderboard } from "./USAlgo2025Leaderboard";
import CarouselComponent from "./CarouselComponent";

export function SelectToolComponent() {
  return (
    <div className="text-center w-full">
      <div className="mx-auto my-2 md:my-4">
        <div className="flex flex-col lg:flex-row items-center justify-evenly lg:gap-2 gap-4">
          <CarouselComponent
            images={[
              { path: "./wenwallet.png", url: "https://wallet.wen.tools" },
              { path: "./wenswap.png", url: "https://swap.wen.tools" },
              {
                path: "./wenbot.png",
                url: "https://discord.com/oauth2/authorize?client_id=1325220652332089435",
              },
            ]}
          />
          <CarouselComponent
            images={[
              { path: "./usalgo.gif", url: "https://algoxnft.com/shuffle/2943" },
              { path: "./AEwebp.webp", url: "https://astroexplorer.co/" },
            ]}
          />
        </div>
      </div>
      <p className="col-span-3 text-center text-2xl lg:text-4xl font-semibold tracking-tight text-white font-sans py-2 pb-6 border-b border-t border-dashed border-secondary-gray">
        our <span className="text-amber-400">top</span> tools
        <div className="grid grid grid-cols-2 md:grid-cols-4 xl:w-[70%] w-full justify-center gap-2 items-stretch mx-auto">
          {TOOLS.filter((tool) =>
            [
              "Simple Mint",
              "Airdrop",
              "Simple Send",
              "Multimint Asset Holders",
            ].includes(tool.label)
          )
            .slice(0, 4) // Ensures only 4 tools are shown
            .map((tool) => (
              <Link to={tool.path}>
                <div
                  className="button-link group relative flex flex-col mt-2.5 h-full align-content-stretch rounded-[36px] bg-banner-grey p-2.5 text-center transition-transform duration-100 ease-in-out hover:scale-[0.97]"
                  key={tool.id}
                >
                  <div className="relative flex items-center mb-[50px] w-full h-[70px] rounded-t-[28px] bg-gradient-to-r from-[#E4E808] to-[#FD941D]">
                    <div className="absolute top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                      <div className="relative flex items-center justify-center w-20 h-20 text-center rounded-full bg-[#262626] flex-shrink-0 border-transparent bg-gradient-to-r from-yellow-400 to-orange-400 p-1 ">
                        <div className="flex items-center justify-center w-full h-full rounded-full bg-[#262626]">
                          <img
                            src={tool.icon}
                            alt="icon"
                            className="w-[70%] h-[70%] invert-[0.9]"
                          ></img>
                        </div>{" "}
                      </div>
                    </div>
                  </div>
                  <h5 className="text-xl xl:text-3xl">{tool.label}</h5>
                  <p className="text-sm xl:text-base font-light p-1 mt-2">
                    {tool.description}
                  </p>
                </div>
              </Link>
            ))}
        </div>
      </p>
      <USAlgo2025Leaderboard />

      <p className="col-span-3 text-center text-2xl lg:text-4xl font-semibold tracking-tight text-white font-sans py-4 border-b border-t border-dashed border-secondary-gray">
        all <span className="text-amber-400">asset management</span> tools
        <div className="grid grid grid-cols-2 md:grid-cols-4 xl:w-[70%] w-full justify-center gap-2 items-stretch mx-auto">
          {TOOLS.filter((tool) => tool.category === "asset").map((tool) => (
            <Link to={tool.path}>
              <div
                className="button-link group relative flex flex-col mt-2.5 h-full align-content-stretch rounded-[36px] bg-banner-grey p-2.5 text-center transition-transform duration-100 ease-in-out hover:scale-[0.97]"
                key={tool.id}
              >
                <div className="relative flex items-center mb-[50px] w-full h-[70px] rounded-t-[28px] bg-gradient-to-r from-[#E4E808] to-[#FD941D]">
                  <div className="absolute top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <div className="relative flex items-center justify-center w-20 h-20 text-center rounded-full bg-[#262626] flex-shrink-0 border-transparent bg-gradient-to-r from-yellow-400 to-orange-400 p-1 ">
                      <div className="flex items-center justify-center w-full h-full rounded-full bg-[#262626]">
                        <img
                          src={tool.icon}
                          alt="icon"
                          className="w-[70%] h-[70%] invert-[0.9]"
                        ></img>
                      </div>{" "}
                    </div>
                  </div>
                </div>
                <h5 className="text-xl xl:text-3xl">{tool.label}</h5>
                <p className="text-sm xl:text-base font-light p-1 mt-2">
                  {tool.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </p>

      <p className="col-span-3 text-center text-2xl lg:text-4xl font-semibold tracking-tight text-white font-sans py-4 border-b border-dashed border-secondary-gray">
        all <span className="text-amber-400">mint</span> tools
        <div className="grid grid grid-cols-2 md:grid-cols-4 xl:w-[70%] w-full justify-center gap-2 items-stretch mx-auto">
          {TOOLS.filter((tool) => tool.category === "mint").map((tool) => (
            <Link to={tool.path}>
              <div
                className="button-link group relative flex flex-col mt-2.5 h-full align-content-stretch rounded-[36px] bg-banner-grey p-2.5 text-center transition-transform duration-100 ease-in-out hover:scale-[0.97]"
                key={tool.id}
              >
                <div className="relative flex items-center mb-[50px] w-full h-[70px] rounded-t-[28px] bg-gradient-to-r from-[#E4E808] to-[#FD941D]">
                  <div className="absolute top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <div className="relative flex items-center justify-center w-20 h-20 text-center rounded-full bg-[#262626] flex-shrink-0 border-transparent bg-gradient-to-r from-yellow-400 to-orange-400 p-1 ">
                      <div className="flex items-center justify-center w-full h-full rounded-full bg-[#262626]">
                        <img
                          src={tool.icon}
                          alt="icon"
                          className="w-[70%] h-[70%] invert-[0.9]"
                        ></img>
                      </div>{" "}
                    </div>
                  </div>
                </div>
                <h5 className="text-xl xl:text-3xl">{tool.label}</h5>
                <p className="text-sm xl:text-base font-light p-1 mt-2">
                  {tool.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </p>
    </div>
  );
}
