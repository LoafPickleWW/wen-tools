import { Link } from "react-router-dom";
import { TOOLS } from "../constants";
import CarouselComponent from "./CarouselComponent";

export function SelectToolComponent() {
  return (
    <div className="text-center">
      <p className="col-span-3 text-center text-3xl font-bold tracking-tight text-white">
        Not if, Wen
      </p>
      <CarouselComponent
        images={[
          { path: "./tds.png", url: "https://wen.tools" },
          { path: "./we.png", url: "https://wallet.wen.tools" },
        ]}
      />
      <p className="col-span-3 text-center text-2xl font-bold tracking-tight text-white">
        Asset Tools
      </p>
      <div className="container mx-auto grid lg:grid-cols-3 gap-2">
        {TOOLS.filter((tool) => tool.category === "asset").map((tool) => (
          <div
            className="col-span-3 xl:col-span-1 rounded-lg shadow bg-[#2b2a2a] border border-[#201f1f] hover:bg-[#201f1f]"
            key={tool.id}
          >
            <Link to={tool.path} className="block p-4">
              <h5 className="mb-2 text-2xl font-bold tracking-tight text-white">
                {tool.label}
              </h5>
              <p className="font-normal text-base text-gray-400">
                {tool.description}
              </p>
            </Link>
          </div>
        ))}
      </div>
      <p className="col-span-3 text-center text-2xl font-bold tracking-tight text-white mt-4">
        Mint Tools
      </p>
      <div className="container mx-auto grid lg:grid-cols-3 gap-2">
        {TOOLS.filter((tool) => tool.category === "mint").map((tool) => (
          <div
            className="col-span-3 xl:col-span-1 rounded-lg shadow bg-[#2b2a2a] border border-[#201f1f] hover:bg-[#201f1f]"
            key={tool.id}
          >
            <Link to={tool.path} className="block p-4">
              <h5 className="mb-2 text-2xl font-bold tracking-tight text-white">
                {tool.label}
              </h5>
              <p className="font-normal text-base text-gray-400">
                {tool.description}
              </p>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
