import { Link } from "react-router-dom";
import { TOOLS } from "../utils";

export function SelectToolComponent() {
  return (
    <>
      {/* <p className="text-3xl md:text-5xl font-medium text-center text-red-1000">
        Tools
      </p> */}
      <div className="container mx-auto grid sm:grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 pt-2 md:pt-4 gap-4">
        {TOOLS.map((tool) => (
          <Link
            to={tool.path}
            key={tool.id}
            className="block p-4  border rounded-lg shadow bg-gray-800 border-gray-700 hover:bg-gray-700"
          >
            <h5 className="mb-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {tool.label}
            </h5>
            <p className="font-normal text-base text-gray-700 dark:text-gray-400">
              {tool.description}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
