"use client";

import { useState } from "react";
import { HeartIcon, HeartFilledIcon } from "./icons";

export function SaveButton({ initialSaved = false, className = "" }: { initialSaved?: boolean; className?: string }) {
  const [saved, setSaved] = useState(initialSaved);
  return (
    <button
      type="button"
      aria-label={saved ? "Unsave event" : "Save event"}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setSaved((s) => !s);
      }}
      className={`grid size-9 place-items-center rounded-full bg-white text-[#1e0a3c] shadow-sm transition hover:scale-105 ${className}`}
    >
      {saved ? <HeartFilledIcon className="size-[18px] text-[#f05537]" /> : <HeartIcon className="size-[18px]" />}
    </button>
  );
}
