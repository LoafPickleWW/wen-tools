import { Link } from "react-router-dom";
import { TOOLS } from "../constants";
import { useState } from "react";

export function SelectToolComponent() {
  const [selectedCategory, setSelectedCategory] = useState("all");

  return (
    <div className="container mx-auto grid lg:grid-cols-3 xl:grid-cols-5 gap-2">
      <p className="col-span-3 xl:col-span-5 text-center text-2xl font-bold tracking-tight text-white">
        Select a Tool
      </p>
      <div className="col-span-3 xl:col-span-5">
        <select
          className="block w-min mx-auto py-2 px-4 border rounded-lg shadow bg-gray-800 border-gray-700 hover:bg-gray-700"
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value="all">all</option>
          {TOOLS.map((tool) => tool.category)
            .filter((value, index, self) => self.indexOf(value) === index)
            .map((category) => (
              <option value={category}>{category}</option>
            ))}
        </select>
      </div>
      {TOOLS.map((tool) => (
        <div
          className={`col-span-3 xl:col-span-1 rounded-lg shadow bg-gray-800 border border-gray-700 hover:bg-gray-700 ${
            selectedCategory === "all" ||
            selectedCategory === tool.category.toLowerCase()
              ? ""
              : "hidden"
          }`}
        >
          <Link to={tool.path} key={tool.id} className="block p-4">
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
  );
}
