import { Link } from "react-router-dom";
import { TOOLS } from "../constants";

export function SelectToolComponent() {
  return (
    <div className="text-center">
      <div className="mx-auto my-2 md:my-4">
        <div className="flex flex-col lg:flex-row items-center justify-evenly lg:gap-2 gap-4">
          <a
            href="https://wallet.wen.tools/"
            target="blank"
            className="lg:w-[34%] w-[70%]"
          >
            <img src="/wenwallet.png" alt="" />
          </a>
          <a
            href="https://swap.wen.tools/"
            target="blank"
            className="lg:w-[34%] w-[70%]"
          >
            <img src="/wenswap.png" alt="" />
          </a>
        </div>
      </div>
      <p className="col-span-3 text-start  text-2xl lg:text-4xl font-semibold tracking-tight text-white font-sans py-4">
        asset tools
      </p>
      <div className="container gap-6 cursor-pointer grid lg:grid-cols-3 py-4">
        {TOOLS.filter((tool) => tool.category === "asset").map((tool) => (
          <div className="w-full rounded-[36px] bg-gradient-to-r from-[#E4E808] to-[#FD941D] hover:bg-none p-1">
            <div
              className="flex flex-col rounded-[36px] border-transparent bg-black gap-3 p-8 w-[100%] h-[100%] text-[#FDFDFD] shadow bg-[#000] transition duration-200 ease-in-out hover:text-black hover:bg-gradient-to-r from-[#E4E808] to-[#FD941D] hover:border-2 relative group"
              key={tool.id}
            >
              <Link
                to={tool.path}
                className="block  transform -translate-y-[-1.5rem] flex flex-col items-center justify-center duration-200 ease-in-out group-hover:-translate-y-0"
              >
                <h5 className=" text-2xl font-medium ">{tool.label}</h5>
              </Link>
              {/* Description shown on hover */}
              <p className="font-medium text-center text-black  transition-display duration-200 ease-in-out group-hover:block rounded-3xl">
                {tool.description}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="col-span-3 text-start text-4xl font-semibold tracking-tight text-white font-sans py-4">
        Mint Tools
      </p>
      <div className="container gap-6 cursor-pointer grid lg:grid-cols-3 py-4">
        {TOOLS.filter((tool) => tool.category === "mint").map((tool) => (
          <div className="w-full rounded-[36px] bg-gradient-to-r from-[#E4E808] to-[#FD941D] hover:bg-none p-1">
            <div
              className="flex flex-col rounded-[36px] border-transparent bg-black gap-3 p-8 w-[100%] h-[100%] text-[#FDFDFD] shadow bg-[#000] transition duration-200 ease-in-out hover:text-black hover:bg-gradient-to-r from-[#E4E808] to-[#FD941D] hover:border-2 relative group"
              key={tool.id}
            >
              <Link
                to={tool.path}
                className="block  transform -translate-y-[-1.5rem] flex flex-col items-center justify-center duration-200 ease-in-out group-hover:-translate-y-0"
              >
                <h5 className=" text-2xl font-medium ">{tool.label}</h5>
              </Link>
              {/* Description shown on hover */}
              <p className="font-medium text-center text-black  transition-display duration-200 ease-in-out group-hover:block rounded-3xl">
                {tool.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
