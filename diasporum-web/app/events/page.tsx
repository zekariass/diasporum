import Link from "next/link";
import { Suspense, type ComponentType } from "react";
import { CATEGORIES, EVENTS } from "@/lib/events/mock-events";
import {
  activeFilterCount,
  discoverEvents,
  selectionFromQuery,
  type FilterSelection,
} from "@/lib/events/discovery";
import { SiteHeader } from "@/components/events/site-header";
import { SiteFooter } from "@/components/events/site-footer";
import { EventCard } from "@/components/events/event-card";
import { FilterDrawer, SortSelect } from "@/components/events/filter-controls";
import {
  ArtsIcon,
  BusinessIcon,
  CelebrationIcon,
  ChevronDownIcon,
  CommunityIcon,
  EducationIcon,
  FoodIcon,
  MusicIcon,
  SportsIcon,
  XIcon,
} from "@/components/events/icons";

const CATEGORY_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  music: MusicIcon,
  "food-drink": FoodIcon,
  arts: ArtsIcon,
  business: BusinessIcon,
  community: CommunityIcon,
  sports: SportsIcon,
  education: EducationIcon,
  holiday: CelebrationIcon,
};

const DATE_LABELS: Record<string, string> = {
  today: "Today",
  weekend: "This weekend",
  week: "This week",
  month: "This month",
};
const PRICE_LABELS: Record<string, string> = { free: "Free", paid: "Paid" };
const MODE_LABELS: Record<string, string> = { inperson: "In person", online: "Online" };

const POPULAR_CITIES = ["London", "Birmingham", "Manchester", "Toronto", "Dubai", "Nairobi", "Melbourne", "New York"];
const TRENDING = ["Cultural festivals", "Networking", "Food markets", "Comedy nights", "Language classes", "Charity fundraisers"];

interface Query {
  date?: string;
  price?: string;
  mode?: string;
  category?: string;
  sort?: string;
  q?: string;
  location?: string;
}

function href(overrides: Partial<Record<keyof Query, string | undefined>> & { categories?: string[] }, base: Query) {
  const merged: Query = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (k === "categories") continue;
    if (v === undefined) delete merged[k as keyof Query];
    else (merged as Record<string, string | undefined>)[k] = v as string;
  }
  if (overrides.categories !== undefined) {
    if (overrides.categories.length > 0) merged.category = overrides.categories.join(",");
    else delete merged.category;
  }
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
  const s = sp.toString();
  return `/events${s ? `?${s}` : ""}`;
}

export default function EventsPage(props: PageProps<"/events">) {
  return (
    <div className="bg-[#f8f7fa]">
      <Suspense fallback={<BrowseFallback />}>
        <Browse searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

function BrowseFallback() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1272px] px-6 pb-16 pt-6">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="animate-pulse overflow-hidden rounded-lg bg-white">
              <div className="aspect-[16/9] bg-[#eeedf2]" />
              <div className="space-y-2 p-3">
                <div className="h-3 w-24 rounded bg-[#eeedf2]" />
                <div className="h-4 w-full rounded bg-[#eeedf2]" />
                <div className="h-3 w-32 rounded bg-[#eeedf2]" />
              </div>
            </div>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

async function Browse({ searchParams }: Pick<PageProps<"/events">, "searchParams">) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const query: Query = {
    date: first(sp.date),
    price: first(sp.price),
    mode: first(sp.mode),
    category: first(sp.category),
    sort: first(sp.sort) ?? "relevance",
    q: first(sp.q),
    location: first(sp.location) ?? "London",
  };
  const location = query.location ?? "London";
  const sort = query.sort ?? "relevance";

  const selection: FilterSelection = selectionFromQuery(query);
  const items = discoverEvents(query);
  const promoted = EVENTS.filter((e) => e.promoted && e.event.id !== items[0]?.event.id).slice(0, 5);
  const filterCount = activeFilterCount(selection);

  // Removable chips describing the applied filters.
  const chips: { key: string; label: string; removeHref: string }[] = [];
  if (selection.date !== "any") {
    chips.push({ key: "date", label: DATE_LABELS[selection.date] ?? selection.date, removeHref: href({ date: undefined }, query) });
  }
  if (selection.price !== "any") {
    chips.push({ key: "price", label: PRICE_LABELS[selection.price] ?? selection.price, removeHref: href({ price: undefined }, query) });
  }
  if (selection.mode !== "any") {
    chips.push({ key: "mode", label: MODE_LABELS[selection.mode] ?? selection.mode, removeHref: href({ mode: undefined }, query) });
  }
  for (const cat of selection.categories) {
    const label = CATEGORIES.find((c) => c.categoryKey === cat)?.displayName ?? cat;
    chips.push({
      key: `cat-${cat}`,
      label,
      removeHref: href({ categories: selection.categories.filter((c) => c !== cat) }, query),
    });
  }

  const paramsString = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <>
      <SiteHeader query={query.q ?? ""} location={location} />

      {/* Category rail */}
      <nav aria-label="Categories" className="mx-auto max-w-[1272px] px-6">
        <ul className="flex gap-2 overflow-x-auto py-5 sm:justify-between">
          {CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.categoryKey] ?? CommunityIcon;
            const active = selection.categories.includes(cat.categoryKey);
            return (
              <li key={cat.id} className="shrink-0">
                <Link
                  href={href({ categories: active ? selection.categories.filter((c) => c !== cat.categoryKey) : [cat.categoryKey] }, query)}
                  className="group flex w-[86px] flex-col items-center gap-2"
                >
                  <span
                    className={`grid size-16 place-items-center rounded-full border transition ${
                      active
                        ? "border-[#3d64ff] bg-[#3d64ff] text-white"
                        : "border-[#dbdae3] bg-white text-[#39364f] group-hover:border-[#3d64ff] group-hover:text-[#3d64ff]"
                    }`}
                  >
                    <Icon className="size-6" />
                  </span>
                  <span className={`text-center text-[12px] leading-tight ${active ? "font-semibold text-[#3d64ff]" : "text-[#39364f]"}`}>
                    {cat.displayName}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Location + filter bar */}
      <div className="mx-auto max-w-[1272px] border-b border-[#dbdae3] px-6 pb-4">
        <p className="flex items-center gap-1 text-sm text-[#6f7287]">
          Browsing events in
          <button type="button" className="flex items-center gap-0.5 font-semibold text-[#3d64ff] hover:underline">
            {location} <ChevronDownIcon className="size-3.5" />
          </button>
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <FilterDrawer
            selection={selection}
            categories={CATEGORIES.map((c) => ({ key: c.categoryKey, label: c.displayName }))}
            baseParams={{ q: query.q, location, sort }}
          />

          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chip.removeHref}
              className="group inline-flex items-center gap-1.5 rounded-full bg-[#e8ecff] px-3 py-1.5 text-[13px] font-semibold text-[#3d64ff] transition hover:bg-[#d8dfff]"
            >
              {chip.label}
              <XIcon className="size-3.5 opacity-60 transition group-hover:opacity-100" />
            </Link>
          ))}

          {filterCount > 0 && (
            <Link href="/events" className="text-[13px] font-semibold text-[#6f7287] hover:text-[#1e0a3c] hover:underline">
              Clear all
            </Link>
          )}

          <div className="ml-auto flex items-center gap-4">
            <span className="text-sm text-[#6f7287]">
              {items.length} {items.length === 1 ? "event" : "events"}
            </span>
            <SortSelect sort={sort} params={paramsString} />
          </div>
        </div>
      </div>

      {/* Card grid */}
      <main className="mx-auto max-w-[1272px] px-6 pb-16 pt-6">
        {items.length === 0 ? (
          <div className="rounded-lg bg-white py-20 text-center">
            <h2 className="text-xl font-bold text-[#1e0a3c]">No events found</h2>
            <p className="mt-2 text-sm text-[#6f7287]">Try a different filter or search term.</p>
            <Link href="/events" className="mt-4 inline-block font-semibold text-[#3d64ff] hover:underline">
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <EventCard key={item.event.id} item={item} />
            ))}
          </div>
        )}

        {/* Curated rail */}
        {promoted.length > 0 && (
          <section className="mt-14">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-xl font-bold text-[#1e0a3c]">Trending in the diaspora</h2>
              <Link href="/events" className="text-sm font-semibold text-[#3d64ff] hover:underline">
                See more
              </Link>
            </div>
            <ul className="-mx-6 flex gap-5 overflow-x-auto px-6 pb-2">
              {promoted.map((item) => (
                <li key={item.event.id} className="w-[280px] shrink-0">
                  <EventCard item={item} compact />
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Text link clusters */}
        <section className="mt-14 space-y-10">
          <div>
            <h2 className="mb-4 text-lg font-bold text-[#1e0a3c]">Popular cities</h2>
            <ul className="flex flex-wrap gap-2.5">
              {POPULAR_CITIES.map((c) => (
                <li key={c}>
                  <Link
                    href={`/events?location=${encodeURIComponent(c)}`}
                    className="rounded-full border border-[#dbdae3] bg-white px-4 py-2 text-sm text-[#39364f] transition hover:border-[#3d64ff] hover:text-[#3d64ff]"
                  >
                    {c}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="mb-4 text-lg font-bold text-[#1e0a3c]">Trending searches</h2>
            <ul className="flex flex-wrap gap-2.5">
              {TRENDING.map((t) => (
                <li key={t}>
                  <Link
                    href={`/events?q=${encodeURIComponent(t)}`}
                    className="rounded-full border border-[#dbdae3] bg-white px-4 py-2 text-sm text-[#39364f] transition hover:border-[#3d64ff] hover:text-[#3d64ff]"
                  >
                    {t}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
