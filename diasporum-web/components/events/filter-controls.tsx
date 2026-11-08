"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SELECTION,
  FACETS,
  matches,
  matchesQuery,
  type FilterSelection,
} from "@/lib/events/discovery";
import { CheckIcon, FilterIcon, XIcon } from "./icons";

const DATE_OPTIONS = [
  { value: "any", label: "Any day" },
  { value: "today", label: "Today" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

const PRICE_OPTIONS = [
  { value: "any", label: "Any price" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
];

const MODE_OPTIONS = [
  { value: "any", label: "Any format" },
  { value: "inperson", label: "In person" },
  { value: "online", label: "Online" },
];

interface CommonParams {
  q?: string;
  location?: string;
  sort?: string;
}

function buildHref(sel: FilterSelection, base: CommonParams) {
  const sp = new URLSearchParams();
  if (sel.date !== "any") sp.set("date", sel.date);
  if (sel.price !== "any") sp.set("price", sel.price);
  if (sel.mode !== "any") sp.set("mode", sel.mode);
  if (sel.categories.length > 0) sp.set("category", sel.categories.join(","));
  if (base.q) sp.set("q", base.q);
  if (base.location) sp.set("location", base.location);
  if (base.sort && base.sort !== "relevance") sp.set("sort", base.sort);
  const s = sp.toString();
  return `/events${s ? `?${s}` : ""}`;
}

function RadioRow({
  name,
  value,
  label,
  checked,
  onSelect,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onSelect: (v: string) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-sm text-[#39364f] transition hover:bg-[#f8f7fa]">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="peer sr-only"
      />
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full border-2 transition ${
          checked ? "border-[#3d64ff] bg-[#3d64ff]" : "border-[#a9a8b3] bg-white"
        }`}
      >
        {checked && <span className="size-2 rounded-full bg-white" />}
      </span>
      <span className={checked ? "font-semibold text-[#1e0a3c]" : ""}>{label}</span>
    </label>
  );
}

function CheckboxRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-sm text-[#39364f] transition hover:bg-[#f8f7fa]">
      <input type="checkbox" checked={checked} onChange={onToggle} className="peer sr-only" />
      <span
        className={`grid size-5 shrink-0 place-items-center rounded border-2 transition ${
          checked ? "border-[#3d64ff] bg-[#3d64ff]" : "border-[#a9a8b3] bg-white"
        }`}
      >
        {checked && <CheckIcon className="size-3.5 text-white" strokeWidth={3} />}
      </span>
      <span className={checked ? "font-semibold text-[#1e0a3c]" : ""}>{label}</span>
    </label>
  );
}

export function FilterDrawer({
  selection,
  categories,
  baseParams,
}: {
  selection: FilterSelection;
  categories: { key: string; label: string }[];
  baseParams: CommonParams;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<FilterSelection>(selection);

  const openDrawer = () => {
    setSel(selection); // reset form to the applied (URL) state on each open
    setOpen(true);
  };

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const appliedCount =
    (selection.date !== "any" ? 1 : 0) +
    (selection.price !== "any" ? 1 : 0) +
    (selection.mode !== "any" ? 1 : 0) +
    selection.categories.length;

  const matchCount = useMemo(
    () =>
      FACETS.filter(
        (f) => matches(f, sel) && (!baseParams.q || matchesQuery(f, baseParams.q)),
      ).length,
    [sel, baseParams.q],
  );

  const apply = () => {
    setOpen(false);
    router.push(buildHref(sel, baseParams));
  };

  const clearAll = () => setSel({ ...DEFAULT_SELECTION, categories: [] });

  const toggleCategory = (key: string) =>
    setSel((s) => ({
      ...s,
      categories: s.categories.includes(key)
        ? s.categories.filter((c) => c !== key)
        : [...s.categories, key],
    }));

  return (
    <>
      <button
        type="button"
        onClick={openDrawer}
        className="inline-flex items-center gap-2 rounded-full border border-[#a9a8b3] bg-white px-4 py-2 text-sm font-semibold text-[#39364f] transition hover:border-[#1e0a3c]"
      >
        <FilterIcon className="size-4" />
        Filters
        {appliedCount > 0 && (
          <span className="grid size-5 place-items-center rounded-full bg-[#3d64ff] text-[11px] font-bold text-white">
            {appliedCount}
          </span>
        )}
      </button>

      {/* Backdrop */}
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-50 bg-[#1e0a3c]/50 transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Left drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Filter events"
        className={`fixed inset-y-0 left-0 z-50 flex w-[360px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#eeedf2] px-5 py-4">
          <h2 className="text-lg font-bold text-[#1e0a3c]">Filters</h2>
          <button
            type="button"
            aria-label="Close filters"
            onClick={() => setOpen(false)}
            className="grid size-9 place-items-center rounded-full text-[#39364f] transition hover:bg-[#f8f7fa]"
          >
            <XIcon className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <fieldset className="border-b border-[#eeedf2] pb-4">
            <legend className="mb-2 text-[13px] font-bold uppercase tracking-wider text-[#6f7287]">
              Date
            </legend>
            {DATE_OPTIONS.map((o) => (
              <RadioRow
                key={o.value}
                name="date"
                value={o.value}
                label={o.label}
                checked={sel.date === o.value}
                onSelect={(v) => setSel((s) => ({ ...s, date: v }))}
              />
            ))}
          </fieldset>

          <fieldset className="border-b border-[#eeedf2] py-4">
            <legend className="mb-2 text-[13px] font-bold uppercase tracking-wider text-[#6f7287]">
              Price
            </legend>
            {PRICE_OPTIONS.map((o) => (
              <RadioRow
                key={o.value}
                name="price"
                value={o.value}
                label={o.label}
                checked={sel.price === o.value}
                onSelect={(v) => setSel((s) => ({ ...s, price: v }))}
              />
            ))}
          </fieldset>

          <fieldset className="border-b border-[#eeedf2] py-4">
            <legend className="mb-2 text-[13px] font-bold uppercase tracking-wider text-[#6f7287]">
              Format
            </legend>
            {MODE_OPTIONS.map((o) => (
              <RadioRow
                key={o.value}
                name="mode"
                value={o.value}
                label={o.label}
                checked={sel.mode === o.value}
                onSelect={(v) => setSel((s) => ({ ...s, mode: v }))}
              />
            ))}
          </fieldset>

          <fieldset className="py-4">
            <legend className="mb-2 text-[13px] font-bold uppercase tracking-wider text-[#6f7287]">
              Category
            </legend>
            {categories.map((c) => (
              <CheckboxRow
                key={c.key}
                label={c.label}
                checked={sel.categories.includes(c.key)}
                onToggle={() => toggleCategory(c.key)}
              />
            ))}
          </fieldset>
        </div>

        <div className="flex items-center gap-3 border-t border-[#eeedf2] px-5 py-4">
          <button
            type="button"
            onClick={clearAll}
            className="text-sm font-semibold text-[#6f7287] transition hover:text-[#1e0a3c] hover:underline"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={apply}
            className="ml-auto flex-1 rounded-md bg-[#f05537] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#d43d1f]"
          >
            Show {matchCount} {matchCount === 1 ? "event" : "events"}
          </button>
        </div>
      </aside>
    </>
  );
}

export function SortSelect({ sort, params }: { sort: string; params: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-[#6f7287]">
      <span className="hidden sm:inline">Sort by</span>
      <select
        value={sort}
        onChange={(e) => {
          const sp = new URLSearchParams(params);
          if (e.target.value === "relevance") sp.delete("sort");
          else sp.set("sort", e.target.value);
          const s = sp.toString();
          router.push(`/events${s ? `?${s}` : ""}`);
        }}
        className="cursor-pointer rounded-md border border-[#a9a8b3] bg-white px-3 py-2 text-sm font-semibold text-[#39364f] outline-none transition hover:border-[#1e0a3c] focus:border-[#3d64ff]"
      >
        <option value="relevance">Most relevant</option>
        <option value="date">Date</option>
      </select>
    </label>
  );
}
