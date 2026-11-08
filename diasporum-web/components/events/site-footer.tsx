import Link from "next/link";

const COLUMNS: { heading: string; links: string[] }[] = [
  { heading: "Use Diasporum", links: ["Create Events", "Pricing", "Community Guidelines", "FAQs"] },
  { heading: "Plan Events", links: ["Sell Tickets Online", "Event Planning", "Community Events", "Online Events"] },
  { heading: "Find Events", links: ["Browse London Events", "This Weekend", "Free Events", "Online Events"] },
  { heading: "Connect With Us", links: ["Contact Support", "X", "Facebook", "LinkedIn", "Instagram"] },
];

export function SiteFooter() {
  return (
    <footer className="bg-[#1e0a3c] text-white">
      <div className="mx-auto max-w-[1272px] px-6 py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className="mb-4 text-sm font-bold uppercase tracking-wider">{col.heading}</h4>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l}>
                    <Link href="/events" className="text-sm text-white/75 hover:text-white hover:underline">
                      {l}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-white/15 pt-6 text-[13px] text-white/60">
          <span>© 2026 Diasporum</span>
          <Link href="/events" className="hover:text-white">Terms</Link>
          <Link href="/events" className="hover:text-white">Privacy</Link>
          <Link href="/events" className="hover:text-white">Cookies</Link>
        </div>
      </div>
    </footer>
  );
}
