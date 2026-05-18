import { IoSearch } from "react-icons/io5";
import { SUGGESTED_CATEGORIES } from "../../utils/agentContract";

interface AgentFiltersProps {
  search: string;
  onSearchChange: (val: string) => void;
  category: string;
  onCategoryChange: (val: string) => void;
}

export function AgentFilters({ search, onSearchChange, category, onCategoryChange }: AgentFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 w-full">
      {/* Search */}
      <div className="relative flex-1">
        <IoSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search agents..."
          className="w-full bg-primary-black border border-secondary-gray rounded-xl pl-9 pr-4 py-2.5 text-white text-sm focus:border-orange-500/50 outline-none transition-all placeholder:text-neutral-600"
        />
      </div>

      {/* Category filter */}
      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="bg-primary-black border border-secondary-gray rounded-xl px-4 py-2.5 text-neutral-400 font-bold text-xs focus:border-orange-500/50 outline-none transition-all uppercase tracking-wider min-w-[140px]"
      >
        <option value="">All Categories</option>
        {SUGGESTED_CATEGORIES.map((cat) => (
          <option key={cat} value={cat}>
            {cat}
          </option>
        ))}
      </select>
    </div>
  );
}
