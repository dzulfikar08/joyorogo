import { useQuery } from "@tanstack/react-query";

import { useUnreadCount } from "@/src/lib/group";
import { orpc } from "@/utils/orpc";

/**
 * Tab badge counts, undefined when there is nothing unread. `feed`: social notifications (kudos/comment/follow);
 * `more`: the group inbox. Shared by the Android floating bar and the iOS native tabs.
 */
export function useTabBadges(): { feed: number | undefined; more: number | undefined } {
  const unread = useUnreadCount();
  const social = useQuery(orpc.social.notificationsUnreadCount.queryOptions());
  const more = unread.data?.count ?? 0;
  const feed = social.data?.count ?? 0;
  return { feed: feed > 0 ? feed : undefined, more: more > 0 ? more : undefined };
}
