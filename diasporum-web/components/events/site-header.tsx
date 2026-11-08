import Link from "next/link";
import { ChevronDownIcon, PinIcon, SearchIcon } from "./icons";

const NAV_LINK = "rounded-md px-3 py-2 text-sm text-[#39364f] transition hover:bg-[#f8f7fa] hover:text-[#3d64ff]";

export function SiteHeader({
  query = "",
  location = "London",
}: {
  query?: string;
  location?: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#eeedf2] bg-white shadow-[0_1px_2px_rgba(30,10,60,0.04)]">
      <div className="mx-auto flex h-[68px] max-w-[1272px] items-center gap-5 px-6">
        <Link href="/events" className="text-[24px] font-bold leading-none tracking-tight text-[#f05537]">
          diasporum
        </Link>

        {/* Desktop search pill */}
        <form
          action="/events"
          className="hidden h-11 flex-1 items-center rounded-full border border-[#a9a8b3] bg-white transition focus-within:border-[#3d64ff] focus-within:ring-4 focus-within:ring-[#3d64ff]/15 md:flex"
        >
          <div className="flex flex-1 items-center gap-2 pl-5">
            <SearchIcon className="size-4 shrink-0 text-[#6f7287]" />
            <input
              name="q"
              defaultValue={query}
              placeholder="Search events"
              className="w-full bg-transparent text-sm text-[#1e0a3c] outline-none placeholder:text-[#6f7287]"
            />
          </div>
          <div className="h-6 w-px bg-[#dbdae3]" />
          <div className="flex w-[220px] items-center gap-2 pl-4">
            <PinIcon className="size-4 shrink-0 text-[#6f7287]" />
            <input
              name="location"
              defaultValue={location}
              placeholder="Choose a location"
              className="w-full bg-transparent text-sm text-[#1e0a3c] outline-none placeholder:text-[#6f7287]"
            />
          </div>
          <button
            type="submit"
            aria-label="Search"
            className="m-1 grid size-9 shrink-0 place-items-center rounded-full bg-[#f05537] text-white transition hover:bg-[#d43d1f]"
          >
            <SearchIcon className="size-4" strokeWidth={2.5} />
          </button>
        </form>

        <nav className="ml-auto hidden items-center gap-1 lg:flex">
          <Link href="/events" className={NAV_LINK}>
            Find events
          </Link>
          <Link href="/events" className={NAV_LINK}>
            Create Events
          </Link>
          <button type="button" className={`${NAV_LINK} flex items-center gap-1`}>
            Help Center <ChevronDownIcon className="size-3.5" />
          </button>
          <button type="button" className={`${NAV_LINK} flex items-center gap-1`}>
            Find my tickets <ChevronDownIcon className="size-3.5" />
          </button>
          <Link href="/events" className={NAV_LINK}>
            Log In
          </Link>
          <Link
            href="/events"
            className="ml-1 rounded-md border border-[#a9a8b3] px-4 py-2 text-sm font-semibold text-[#39364f] transition hover:border-[#1e0a3c] hover:bg-[#f8f7fa]"
          >
            Sign Up
          </Link>
        </nav>

        <button type="button" aria-label="Open menu" className="ml-auto grid size-10 place-items-center rounded-md transition hover:bg-[#f8f7fa] lg:hidden">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#39364f" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      {/* Mobile search row */}
      <div className="border-t border-[#eeedf2] px-4 py-2.5 md:hidden">
        <form action="/events" className="flex h-10 items-center rounded-full border border-[#a9a8b3] bg-white">
          <div className="flex flex-1 items-center gap-2 pl-4">
            <SearchIcon className="size-4 shrink-0 text-[#6f7287]" />
            <input
              name="q"
              defaultValue={query}
              placeholder="Search events"
              className="w-full bg-transparent text-sm text-[#1e0a3c] outline-none placeholder:text-[#6f7287]"
            />
          </div>
          <div className="h-5 w-px bg-[#dbdae3]" />
          <div className="flex w-[130px] items-center gap-2 pl-3">
            <PinIcon className="size-4 shrink-0 text-[#6f7287]" />
            <input
              name="location"
              defaultValue={location}
              placeholder="Location"
              className="w-full bg-transparent text-sm text-[#1e0a3c] outline-none placeholder:text-[#6f7287]"
            />
          </div>
          <button
            type="submit"
            aria-label="Search"
            className="m-1 grid size-8 shrink-0 place-items-center rounded-full bg-[#f05537] text-white"
          >
            <SearchIcon className="size-3.5" strokeWidth={2.5} />
          </button>
        </form>
      </div>
    </header>
  );
}
