import { useEffect, useState } from "react";
import { useSession } from "@/core/session/session-provider";
import { createCommunityApi } from "@/features/communities/services/community-api";

/** communityId → display name for audience pickers; falls back to the raw id. */
export function useCommunityNames(): (communityId: string) => string {
  const { apiClient } = useSession();
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    createCommunityApi(apiClient)
      .availableCommunities()
      .then((result) => {
        if (!active) return;
        setNames(Object.fromEntries(result.items.map((community) => [community.id, community.name])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [apiClient]);
  return (communityId: string) => names[communityId] ?? communityId;
}
