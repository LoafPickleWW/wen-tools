import { Link } from "react-router-dom";
import { TOOLS } from "../constants";

export function SelectToolComponent() {
  return (
    <div className="container mx-auto grid lg:grid-cols-3 xl:grid-cols-5 pt-2 md:pt-4 gap-4">
      {TOOLS.map((tool) => (
        <Link
          to={tool.path}
          key={tool.id}
          className="block p-4  border rounded-lg shadow bg-gray-800 border-gray-700 hover:bg-gray-700"
        >
          <h5 className="mb-2 text-2xl font-bold tracking-tight text-white">
            {tool.label}
          </h5>
          <p className="font-normal text-base text-gray-400">
            {tool.description}
          </p>
        </Link>
      ))}
    </div>
  );
}
