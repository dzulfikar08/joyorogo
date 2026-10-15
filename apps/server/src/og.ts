import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";

import { loadPublicGroupPreview } from "@joyorogo/api/lib/group-preview";
import type { Database } from "@joyorogo/db";
import { user } from "@joyorogo/db/schema/auth";
import { profile } from "@joyorogo/db/schema/fitness";
import { post } from "@joyorogo/db/schema/social";

type Deps = { getDb: () => Database };

const POST_ID = /^[a-f0-9-]{36}$/;
// Chosen handles, or the placeholder profile.upsert hands out (jr-<8 hex>).
const HANDLE = /^(?:[a-z0-9_]{3,20}|jr-[0-9a-f]{8})$/;
const CODE = /^[A-Za-z0-9]{4,20}$/;

/** Link previews are a public surface: crawlers get a short slice of text, never a whole caption. */
function clip(text: string | null, max: number): string | null {
  const flat = text?.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * Minimal data for the web Worker's server-rendered link-preview tags
 * (apps/web/worker). Same rules as the public pages themselves: a post shows
 * only when it is 'publik' and its author's profile is public, a profile only
 * when it is public. Everything else answers 404, the same as a code or id
 * that does not exist, so a preview never confirms that a private thing is there.
 * Short public cache: the Worker also caches, so a flipped privacy switch
 * reaches previews within about a minute.
 */
export function registerOgRoutes(app: Hono, deps: Deps) {
  const notFound = (c: { json: (body: unknown, status: 404) => Response }) => c.json({ error: "Tidak ada." }, 404);
  const ok = (c: { header: (k: string, v: string) => void; json: (body: unknown) => Response }, body: unknown) => {
    c.header("Cache-Control", "public, max-age=60");
    return c.json(body);
  };

  app.get("/og/gabung/:code", async (c) => {
    const code = c.req.param("code");
    if (!CODE.test(code)) return notFound(c);
    const found = await loadPublicGroupPreview(deps.getDb(), code);
    if (!found) return notFound(c);
    return ok(c, { name: found.name, memberCount: found.memberCount });
  });

  app.get("/og/p/:id", async (c) => {
    const id = c.req.param("id");
    if (!POST_ID.test(id)) return notFound(c);
    const [row] = await deps
      .getDb()
      .select({
        kind: post.kind,
        title: post.title,
        caption: post.caption,
        photoId: post.photoId,
        photosJson: post.photosJson,
        authorName: user.name,
      })
      .from(post)
      .innerJoin(user, eq(user.id, post.userId))
      .innerJoin(profile, eq(profile.userId, post.userId))
      .where(and(eq(post.id, id), eq(post.visibility, "publik"), eq(profile.publicProfile, true)))
      .limit(1);
    if (!row) return notFound(c);
    let photos = 0;
    try {
      const parsed = row.photosJson ? (JSON.parse(row.photosJson) as unknown) : [];
      photos = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      // unreadable list: fall back to the legacy single photo below
    }
    return ok(c, {
      kind: row.kind,
      title: clip(row.title, 80),
      caption: clip(row.caption, 160),
      authorName: clip(row.authorName, 40),
      hasPhoto: photos > 0 || row.photoId !== null,
    });
  });

  app.get("/og/u/:handle", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    if (!HANDLE.test(handle)) return notFound(c);
    const [row] = await deps
      .getDb()
      .select({ name: user.name, image: user.image, bio: profile.bio })
      .from(profile)
      .innerJoin(user, eq(user.id, profile.userId))
      .where(and(eq(profile.handle, handle), eq(profile.publicProfile, true)))
      .limit(1);
    if (!row) return notFound(c);
    return ok(c, {
      name: clip(row.name, 40),
      bio: clip(row.bio, 160),
      image: row.image && row.image.startsWith("https://") ? row.image : null,
    });
  });
}
