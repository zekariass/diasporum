import Link from "next/link";
import { notFound } from "next/navigation";
import { EVENTS, getEvent } from "@/lib/events/mock-events";
import { attendeesLabel, dateTimeRange, followersLabel, headerDate, priceLabel } from "@/lib/events/format";
import { SiteHeader } from "@/components/events/site-header";
import { SiteFooter } from "@/components/events/site-footer";
import { EventCard } from "@/components/events/event-card";
import { EventArt } from "@/components/events/event-art";
import { SaveButton } from "@/components/events/save-button";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  PinIcon,
  RefundIcon,
  ShareIcon,
  TicketIcon,
  VideoIcon,
} from "@/components/events/icons";

export function generateStaticParams() {
  return EVENTS.map((e) => ({ id: e.event.id }));
}

export default async function EventDetailPage({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const item = getEvent(id);
  if (!item) notFound();

  const { event } = item;
  const isOnline = event.eventMode === "ONLINE_EXTERNAL";
  const similar = EVENTS.filter(
    (e) => e.event.id !== event.id && e.event.categoryId === event.categoryId,
  ).slice(0, 4);
  const spotsLeft = event.capacity ? Math.max(event.capacity - item.counts.going, 0) : null;

  return (
    <div className="bg-[#f8f7fa]">
      <SiteHeader />

      {/* Blurred hero backdrop + clean image card (Eventbrite style) */}
      <div className="relative">
        <div className="absolute inset-0 overflow-hidden">
          <EventArt palette={item.coverPalette} decorative className="size-full scale-125 blur-2xl" />
          <div className="absolute inset-0 bg-[#1e0a3c]/25" />
        </div>

        <div className="relative mx-auto max-w-[1104px] px-6 pb-10 pt-8">
          <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="aspect-[21/9] w-full">
              <EventArt palette={item.coverPalette} className="size-full" />
            </div>

            <div className="px-6 pb-6 pt-5 md:px-10">
              <p className="text-sm font-semibold uppercase tracking-wide text-[#d1410c]">
                {headerDate(event.startsAt)}
              </p>
              <h1 className="mt-1 max-w-3xl text-2xl font-bold leading-tight text-[#1e0a3c] md:text-[32px]">
                {event.title}
              </h1>
              <p className="mt-3 text-[15px] text-[#6f7287]">
                By{" "}
                <Link href="/events" className="font-semibold text-[#3d64ff] hover:underline">
                  {item.organizer.displayName}
                </Link>{" "}
                · {item.communityName}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Body: content + sticky ticket module */}
      <main className="mx-auto max-w-[1104px] px-6 pb-24">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* Left column */}
          <div className="min-w-0">
            <div className="mb-6 flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eeedf2] px-3 py-1.5 text-[13px] font-semibold text-[#39364f]">
                <ClockIcon className="size-4" />
                {dateTimeRange(event.startsAt, event.endsAt)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eeedf2] px-3 py-1.5 text-[13px] font-semibold text-[#39364f]">
                {isOnline ? <VideoIcon className="size-4" /> : <PinIcon className="size-4" />}
                {isOnline ? "Online event" : "In person"}
              </span>
            </div>

            <h2 className="text-lg font-bold text-[#1e0a3c]">About this event</h2>
            <div className="mt-3 space-y-4 text-[15px] leading-relaxed text-[#39364f]">
              <p>
                {event.description ||
                  `${item.organizer.displayName} invites you to ${event.title} — a ${item.category?.displayName?.toLowerCase() ?? "community"} gathering hosted by ${item.communityName}.`}
              </p>
              <p>
                {attendeesLabel(item.counts.going)} so far — bring friends and family. Doors open 30 minutes
                before start; please arrive early for registration.
              </p>
            </div>

            <h3 className="mt-8 text-sm font-bold uppercase tracking-wider text-[#6f7287]">Tags</h3>
            <ul className="mt-3 flex flex-wrap gap-2">
              {[item.category?.displayName ?? "Events", item.communityName, isOnline ? "Online" : "London events", "Diaspora"].map(
                (tag) => (
                  <li key={tag}>
                    <Link
                      href="/events"
                      className="rounded-full bg-[#eeedf2] px-4 py-2 text-[13px] font-semibold text-[#39364f] transition hover:bg-[#dbdae3]"
                    >
                      {tag}
                    </Link>
                  </li>
                ),
              )}
            </ul>

            {/* Organizer card */}
            <div className="mt-10 rounded-lg bg-white p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="grid size-14 shrink-0 place-items-center rounded-full bg-[#3d64ff] text-xl font-bold text-white">
                  {item.organizer.displayName.charAt(0)}
                </div>
                <div>
                  <p className="font-bold text-[#1e0a3c]">{item.organizer.displayName}</p>
                  <p className="text-sm text-[#6f7287]">{followersLabel(item.organizer.followers)}</p>
                </div>
              </div>
              <div className="mt-5 flex gap-3">
                <button
                  type="button"
                  className="flex-1 rounded-md border border-[#a9a8b3] px-4 py-2.5 text-sm font-semibold text-[#39364f] transition hover:bg-[#f8f7fa]"
                >
                  Contact
                </button>
                <button
                  type="button"
                  className="flex-1 rounded-md bg-[#3d64ff] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#2b4fd9]"
                >
                  Follow
                </button>
              </div>
            </div>
          </div>

          {/* Right sticky ticket module */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="overflow-hidden rounded-lg bg-white shadow-sm">
              <div className="space-y-4 border-b border-[#eeedf2] p-5">
                <div className="flex gap-3">
                  <CalendarIcon className="mt-0.5 size-5 shrink-0 text-[#6f7287]" />
                  <p className="text-sm text-[#39364f]">{dateTimeRange(event.startsAt, event.endsAt)}</p>
                </div>
                <div className="flex gap-3">
                  {isOnline ? (
                    <VideoIcon className="mt-0.5 size-5 shrink-0 text-[#6f7287]" />
                  ) : (
                    <PinIcon className="mt-0.5 size-5 shrink-0 text-[#6f7287]" />
                  )}
                  <p className="text-sm text-[#39364f]">
                    {isOnline ? "Online event — link shared after RSVP" : event.locationName}
                  </p>
                </div>
                {!isOnline && (
                  <div className="relative h-28 overflow-hidden rounded-md bg-[#e8f4f8]">
                    <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(#c7e4ee_1px,transparent_1px),linear-gradient(90deg,#c7e4ee_1px,transparent_1px)] [background-size:18px_18px]" />
                    <PinIcon className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 text-[#d1410c]" />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#39364f]">
                    <TicketIcon className="size-4 text-[#6f7287]" />
                    {priceLabel(item)}
                  </span>
                  {spotsLeft !== null && spotsLeft < 50 && (
                    <span className="text-[13px] font-semibold text-[#d1410c]">{spotsLeft} spots left</span>
                  )}
                </div>
              </div>
              <div className="p-5">
                <button
                  type="button"
                  className="w-full rounded-md bg-[#f05537] py-3.5 text-[15px] font-bold text-white transition hover:bg-[#d43d1f]"
                >
                  Reserve a spot
                </button>
                <p className="mt-3 flex items-center gap-1.5 text-[13px] text-[#6f7287]">
                  <RefundIcon className="size-4" />
                  Refunds up to 7 days before event
                </p>
                <div className="mt-4 flex items-center gap-3 border-t border-[#eeedf2] pt-4">
                  <SaveButton initialSaved={item.saved} className="border border-[#dbdae3] shadow-none" />
                  <button
                    type="button"
                    aria-label="Share event"
                    className="grid size-9 place-items-center rounded-full border border-[#dbdae3] text-[#1e0a3c] transition hover:bg-[#f8f7fa]"
                  >
                    <ShareIcon className="size-[18px]" />
                  </button>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-[#6f7287]">
                    <CheckIcon className="size-4 text-[#2f855a]" />
                    {attendeesLabel(item.counts.going)}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* Similar events */}
        {similar.length > 0 && (
          <section className="mt-16">
            <h2 className="mb-5 text-xl font-bold text-[#1e0a3c]">Other events you may like</h2>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {similar.map((s) => (
                <EventCard key={s.event.id} item={s} />
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Mobile sticky CTA bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-[#dbdae3] bg-white px-5 py-3 lg:hidden">
        <span className="text-sm font-bold text-[#1e0a3c]">{priceLabel(item)}</span>
        <button
          type="button"
          className="rounded-md bg-[#f05537] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#d43d1f]"
        >
          Reserve a spot
        </button>
      </div>

      <SiteFooter />
    </div>
  );
}

