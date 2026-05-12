import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { TOOLS } from "../constants";
import CarouselComponent from "./CarouselComponent";
import { ToolSearch } from "./ToolSearch";
import { trackEvent } from "../utils";

const CATEGORIES = [
  { id: "featured", label: "Featured" },
  { id: "mint", label: "Minting" },
  { id: "management", label: "Management" },
  { id: "distribution", label: "Distribution" },
  { id: "apps", label: "Apps & Social" },
  { id: "analytics", label: "Analytics" },
  { id: "experimental", label: "Experimental" },
];

const FEATURED_TOOLS = [
  "Simple Mint",
  "Airdrop",
  "Simple Send",
  "BEACON Chat",
];

export function SelectToolComponent() {
  const [activeTab, setActiveTab] = useState("featured");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTools = useMemo(() => {
    let tools = TOOLS;
    
    // If searching, ignore tabs and search globally
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return tools.filter(
        (t) =>
          t.label.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query)
      );
    }

    // Otherwise filter by category
    if (activeTab === "featured") {
      return tools.filter(t => FEATURED_TOOLS.includes(t.label));
    } else {
      return tools.filter(t => t.category === activeTab);
    }
  }, [activeTab, searchQuery]);

  return (
    <div className="text-center w-full max-w-7xl mx-auto px-4">
      {/* Carousels Section */}
      <div className="mx-auto my-4 md:my-8">
        <div className="flex flex-col lg:flex-row items-center justify-center lg:gap-8 gap-6">
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
              { path: "./AEwebp.webp", url: "https://astroexplorer.co/" },
            ]}
          />
        </div>
      </div>

      {/* Navigation & Search */}
      <div className="sticky top-20 z-20 bg-primary-black/80 backdrop-blur-md py-4 mb-6 border-b border-t border-dashed border-secondary-gray">
        <ToolSearch query={searchQuery} setQuery={setSearchQuery} />
        
        <div className="flex overflow-x-auto no-scrollbar pb-2 gap-2 px-2 justify-start lg:justify-center">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setActiveTab(cat.id);
                setSearchQuery("");
              }}
              className={`whitespace-nowrap px-6 py-2 rounded-full font-medium transition-all duration-200 ${
                activeTab === cat.id && !searchQuery
                  ? "bg-amber-400 text-black shadow-lg shadow-amber-400/20 scale-105"
                  : "bg-banner-grey text-slate-300 hover:text-white hover:bg-secondary-gray"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tools Grid */}
      <div className="min-h-[400px]">
        {searchQuery && (
          <h3 className="text-xl text-slate-400 mb-6 animate-fade-in">
            Found {filteredTools.length} tools matching "{searchQuery}"
          </h3>
        )}
        
        {!searchQuery && (
          <h3 className="text-2xl lg:text-4xl font-semibold tracking-tight text-white font-sans mb-8 animate-fade-in capitalize">
            {activeTab === "featured" ? "Our " : "All "} 
            <span className="text-amber-400">{activeTab === "featured" ? "Top" : activeTab}</span> tools
          </h3>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 items-stretch mb-12">
          {filteredTools.map((tool, index) => (
            <Link 
              to={tool.path} 
              key={tool.id + '-' + activeTab}
              className="animate-fade-in"
              style={{ animationDelay: `${index * 50}ms` }}
              onClick={() => trackEvent("tool_click", "home", tool.label)}
            >
              <div className="button-link group relative flex flex-col h-full rounded-[36px] bg-banner-grey p-2.5 text-center transition-all duration-300 ease-in-out hover:scale-[1.02] hover:bg-secondary-gray border border-transparent hover:border-amber-400/30">
                <div className="relative flex items-center mb-[50px] w-full h-[70px] rounded-t-[28px] bg-gradient-to-r from-[#E4E808] to-[#FD941D]">
                  <div className="absolute top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <div className="relative flex items-center justify-center w-20 h-20 text-center rounded-full bg-[#262626] flex-shrink-0 border-transparent bg-gradient-to-r from-yellow-400 to-orange-400 p-1 ">
                      <div className="flex items-center justify-center w-full h-full rounded-full bg-[#262626]">
                        <img
                          src={tool.icon}
                          alt="icon"
                          className="w-[70%] h-[70%] invert-[0.9] group-hover:scale-110 transition-transform"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <h5 className="text-xl xl:text-2xl font-bold text-white group-hover:text-amber-400 transition-colors">
                  {tool.label}
                </h5>
                <p className="text-sm xl:text-base font-light text-slate-300 p-2 mt-2 leading-relaxed">
                  {tool.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
        
        {filteredTools.length === 0 && (
          <div className="text-center py-20 animate-fade-in">
            <p className="text-2xl text-slate-500">No tools found matching your search.</p>
            <button 
              onClick={() => setSearchQuery("")}
              className="mt-4 text-amber-400 hover:underline"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
