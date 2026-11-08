import Link from "next/link";
import type { EventView } from "@/lib/events/types";
import { attendeesLabel, cardDate, priceLabel } from "@/lib/events/format";
import { EventArt } from "./event-art";
import { SaveButton } from "./save-button";
import { PinIcon, VideoIcon } from "./icons";

export function EventCard({ item, compact = false }: { item: EventView; compact?: boolean }) {
  const { event } = item;
  const isOnline = event.eventMode === "ONLINE_EXTERNAL";
  return (
    <Link
      href={`/events/${event.id}`}
      className="group flex flex-col overflow-hidden rounded-lg bg-white transition-shadow hover:shadow-[0_4px_16px_rgba(30,10,60,0.15)]"
    >
      <div className="relative aspect-[16/9] overflow-hidden">
        <EventArt
          palette={item.coverPalette}
          className="size-full transition-transform duration-300 group-hover:scale-105"
        />
        <SaveButton initialSaved={item.saved} className="absolute right-3 top-3" />
        {item.promoted && (
          <span className="absolute left-0 top-3 rounded-r bg-[#3659e3] px-2 py-0.5 text-[11px] font-semibold text-white">
            Promoted
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-[#d1410c]">
          {cardDate(event.startsAt)}
        </p>
        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug text-[#1e0a3c]">
          {event.title}
        </h3>
        <p className="flex items-center gap-1 truncate text-[13px] text-[#6f7287]">
          {isOnline ? (
            <>
              <VideoIcon className="size-3.5 shrink-0" /> Online
            </>
          ) : (
            <>
              <PinIcon className="size-3.5 shrink-0" /> {event.locationName}
            </>
          )}
        </p>
        <p className="text-[13px] font-semibold text-[#3d64ff]">{priceLabel(item)}</p>
        <p className="truncate text-[13px] text-[#6f7287]">{item.organizer.displayName}</p>
        {!compact && (
          <div className="mt-auto flex items-center gap-2 pt-1 text-[12px] text-[#6f7287]">
            <span>{attendeesLabel(item.counts.going)}</span>
            {item.almostFull && (
              <span className="rounded bg-[#fdf0e8] px-1.5 py-0.5 font-semibold text-[#d1410c]">
                Almost full
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
