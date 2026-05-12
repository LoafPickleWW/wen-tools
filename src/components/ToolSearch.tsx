import { MdSearch } from "react-icons/md";

interface ToolSearchProps {
  query: string;
  setQuery: (query: string) => void;
}

export function ToolSearch({ query, setQuery }: ToolSearchProps) {
  return (
    <div className="relative w-full max-w-md mx-auto mb-8 group">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <MdSearch className="h-6 w-6 text-slate-400 group-focus-within:text-amber-400 transition-colors" />
      </div>
      <input
        type="text"
        className="block w-full pl-12 pr-4 py-3 bg-banner-grey border border-secondary-gray rounded-2xl text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:border-amber-400 transition-all shadow-lg"
        placeholder="Search tools by name or description..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </div>
  );
}
