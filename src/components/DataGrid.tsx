import * as React from "react";
import { HeadCell } from "../types";

interface BaseData {
  id: number;
  [key: string]: any;
}

type Order = "asc" | "desc";

interface EnhancedTableProps<T extends BaseData> {
  title: string;
  headCells: HeadCell[];
  data: T[];
  actions: {
    tooltipTitle: string;
    icon: JSX.Element;
    onClick: (
      selected: T[],
      setDisabled: React.Dispatch<React.SetStateAction<boolean>>
    ) => void;
  }[];
  /** Column rendered as a chip (e.g. where the asset is held) */
  chipColumn?: string;
  /** Column shown as the row's primary label on small screens */
  primaryColumn?: string;
  initialOrderBy?: keyof T;
  initialOrder?: Order;
  rowsPerPageOptions?: number[];
  defaultRowsPerPage?: number;
}

const compare = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);

function Check({ state }: { state: "on" | "off" | "some" }) {
  return (
    <span
      aria-hidden
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors ${
        state === "off"
          ? "border-white/25 bg-transparent group-hover:border-white/45"
          : "border-primary-orange bg-primary-orange text-primary-black"
      }`}
    >
      {state === "on" && (
        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M2.5 6.2l2.3 2.3 4.7-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {state === "some" && <span className="h-0.5 w-2 rounded bg-current" />}
    </span>
  );
}

function Chip({ value, short }: { value: string; short?: boolean }) {
  const algox = /algox/i.test(value);
  // Compact on phones: "AlgoxNFT listing · opt-in" -> "AlgoxNFT +opt-in"
  const label = short ? value.replace(/ listing/i, "").replace(/s*·s*/, " +") : value;
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
        algox
          ? "border-primary-orange/35 bg-primary-orange/10 text-orange-300"
          : "border-white/10 bg-white/[0.04] text-slate-300"
      }`}
    >
      {label}
    </span>
  );
}

export function EnhancedTable<T extends BaseData>({
  title,
  headCells,
  data,
  actions,
  chipColumn = "type",
  primaryColumn = "name",
  initialOrderBy = "id" as keyof T,
  initialOrder = "asc",
  rowsPerPageOptions = [10, 25, 50],
  defaultRowsPerPage = 10,
}: EnhancedTableProps<T>) {
  const [order, setOrder] = React.useState<Order>(initialOrder);
  const [orderBy, setOrderBy] = React.useState<keyof T>(initialOrderBy);
  // Selection by row id, so it survives data refreshes
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(defaultRowsPerPage);
  const [disabled, setDisabled] = React.useState(false);

  React.useEffect(() => {
    const ids = new Set(data.map((d) => d.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => ids.has(id))));
    setPage(0);
  }, [data]);

  const sorted = React.useMemo(() => {
    const dir = order === "asc" ? 1 : -1;
    return [...data].sort((a, b) => dir * compare(a[orderBy], b[orderBy]));
  }, [data, order, orderBy]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / rowsPerPage));
  const visible = sorted.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const selected = data.filter((d) => selectedIds.has(d.id));
  const allState = selected.length === 0 ? "off" : selected.length === data.length ? "on" : "some";

  const toggle = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelectedIds(allState === "on" ? new Set() : new Set(data.map((d) => d.id)));
  const sortBy = (id: keyof T) => {
    setOrder(orderBy === id && order === "asc" ? "desc" : "asc");
    setOrderBy(id);
  };

  const secondary = headCells.filter((h) => h.id !== primaryColumn && h.id !== chipColumn);
  const grid = "grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_64px_minmax(0,1.3fr)]";
  const cellOf = (row: T, id: string, short = false) =>
    id === chipColumn ? <Chip value={String(row[id] ?? "")} short={short} /> : row[id];

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-banner-grey/70 text-left shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] backdrop-blur">
      {/* Action bar */}
      <div className="flex min-h-[56px] items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
        <button
          type="button"
          onClick={toggleAll}
          className="group flex items-center gap-2.5 rounded-md py-1 pr-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary-orange"
          aria-label={allState === "on" ? "Deselect all" : "Select all"}
        >
          <Check state={allState} />
        </button>
        <div className="min-w-0 flex-1">
          {selected.length ? (
            <p className="font-mono text-xs text-white">
              <span className="text-primary-orange">{selected.length}</span> of {data.length} selected
            </p>
          ) : (
            <p className="truncate font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
              {title} <span className="text-slate-600">· {data.length}</span>
            </p>
          )}
        </div>
        {actions.map((action) => (
          <button
            key={action.tooltipTitle}
            type="button"
            title={action.tooltipTitle}
            disabled={disabled || selected.length === 0}
            onClick={() => action.onClick(selected, setDisabled)}
            className="wt-btn wt-btn-primary h-9 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {disabled ? "Working…" : action.icon}
            {!disabled && selected.length > 0 && <span className="ml-1 font-mono text-xs opacity-80">({selected.length})</span>}
          </button>
        ))}
      </div>

      {/* Column headers (desktop) */}
      <div
        className={`hidden ${grid} items-center gap-3 border-b border-white/[0.06] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500 sm:grid`}
      >
        <span />
        {[headCells.find((h) => h.id === primaryColumn), ...secondary, headCells.find((h) => h.id === chipColumn)]
          .filter((h): h is HeadCell => !!h)
          .map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => sortBy(h.id as keyof T)}
              className={`flex items-center gap-1 text-left hover:text-slate-300 ${orderBy === h.id ? "text-slate-200" : ""}`}
            >
              {h.label}
              <span className={orderBy === h.id ? "opacity-100" : "opacity-0"}>{order === "asc" ? "↑" : "↓"}</span>
            </button>
          ))}
      </div>

      {/* Rows */}
      <ul role="listbox" aria-multiselectable="true" aria-label={title}>
        {visible.map((row) => {
          const on = selectedIds.has(row.id);
          return (
            <li key={row.id} role="option" aria-selected={on}>
              <button
                type="button"
                onClick={() => toggle(row.id)}
                className={`group w-full border-b border-white/[0.04] px-4 py-3 text-left transition-colors last:border-0 focus-visible:bg-white/[0.04] focus-visible:outline-none ${
                  on ? "bg-primary-orange/[0.07]" : "hover:bg-white/[0.03]"
                }`}
              >
                {/* Mobile: two-line card row */}
                <div className="flex items-center gap-3 sm:hidden">
                  <Check state={on ? "on" : "off"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{row[primaryColumn] || "Unnamed asset"}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                      {secondary.map((h) => (h.numeric && h.id === "amount" ? `×${row[h.id]}` : row[h.id])).join(" · ")}
                    </p>
                  </div>
                  <div className="max-w-[42%] shrink-0">{cellOf(row, chipColumn, true)}</div>
                </div>
                {/* Desktop: grid row */}
                <div className={`hidden ${grid} items-center gap-3 sm:grid`}>
                  <Check state={on ? "on" : "off"} />
                  <span className="truncate text-sm font-medium text-white">{row[primaryColumn] || "Unnamed asset"}</span>
                  {secondary.map((h) => (
                    <span key={h.id} className="truncate font-mono text-xs tabular-nums text-slate-400">
                      {row[h.id]}
                    </span>
                  ))}
                  <span className="min-w-0">{cellOf(row, chipColumn)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Pagination */}
      {sorted.length > rowsPerPageOptions[0] && (
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] px-4 py-2.5 font-mono text-[11px] text-slate-500">
          <label className="flex items-center gap-2">
            rows
            <select
              value={rowsPerPage}
              onChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              className="rounded-md border border-white/10 bg-primary-black px-1.5 py-1 text-slate-300 focus:border-primary-orange focus:outline-none"
            >
              {rowsPerPageOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <span className="mr-2 tabular-nums">
              {page * rowsPerPage + 1}–{Math.min(sorted.length, (page + 1) * rowsPerPage)} of {sorted.length}
            </span>
            <button
              type="button"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="wt-icon-btn h-7 w-7 disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
              className="wt-icon-btn h-7 w-7 disabled:opacity-30"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
