# Comment threads and attachments

Contract of `social.comments`, `social.commentReplies`, `social.addComment`, `social.deleteComment`,
`social.uploadCommentPhoto` and `social.commentAttachables`. JoyoRogo (web, native) and JoyoFit (through `rogoCall`)
both read it; code: `packages/api/src/routers/social.ts`, `packages/api/src/lib/comment-attachment.ts`.

## Shape of a comment

```
Comment = {
  id, body, createdAt,
  author: { id, name, handle, image },
  deleted: boolean,
  parentId: string | null,          // null = top-level
  replyCount: number,               // top-level only; deleted and blocked users' replies are not counted
  replyTo: { id, name, handle } | null,
  attachment: Attachment | null,
}
```

- Two visible levels. A reply to a reply is stored under the top-level comment (`parentId` is always a top-level id) and
  keeps `replyTo` (the person answered). Clients render `@handle ` before the text; `body` carries no mention.
  `replyTo` is null when replying to a top-level comment or to yourself.
- `deleted` is the "komentar dihapus" placeholder: a comment that has replies is blanked (`body` becomes the localized
  "Komentar ini dihapus.", `author` is empty, no attachment) instead of removed, so its thread stays readable. A
  comment without replies is deleted outright. Deleting the last reply of a placeholder removes the placeholder too.
  A placeholder cannot be replied to.
- Old clients: `comments` returns top-level comments only, with the old fields intact, so they keep working and ignore
  `parentId`, `replyCount`, `replyTo`, `attachment` and `deleted`.

## Procedures

| Procedure | Input | Output |
|---|---|---|
| `comments` | `{ postId, cursor?, limit? = 30 }` | `{ items: Comment[] (top-level, oldest first), nextCursor }` |
| `commentReplies` | `{ parentId, cursor?, limit? = 10 }` (a reply id resolves to its thread) | `{ items: Comment[], nextCursor }` |
| `addComment` | `{ postId, body?, parentId?, attachment? }`, body or attachment required, body <= 280 | `{ id, parentId, comment }` |
| `deleteComment` | `{ id }`; the commenter or the post's author | `{ ok, mode: 'removed' \| 'hidden' }` |
| `uploadCommentPhoto` | `{ imageBase64, mimeType: 'image/jpeg' \| 'image/webp' }` (<= ~3 MB) | `{ photoId }` |
| `commentAttachables` | `{ kind }` | `{ items: { kind, refId, photoId, preview }[], notice: 'mapOff' \| null }` |

Cursors are the `createdAt` ms of the last item. The 30-a-day comment quota counts replies. Visibility of the post
applies to every read; a comment from a blocked user is hidden both ways, and you cannot reply to them.

## Comments off

`post.comments_off` (default 0, migration `0072_post_comments_off`). Every feed or post item (`feed`, `myPosts`, `post`,
`publicProfile.posts`) carries `commentsOff: boolean`; the field is additive, JoyoFit ignores it.

| Procedure | Input | Output |
|---|---|---|
| `setCommentsOff` | `{ postId, off }`; the post's author only (`FORBIDDEN` otherwise, `NOT_FOUND` for a missing post); idempotent | `{ ok, commentsOff }` |

- With comments off, `addComment` from anyone but the author answers `FORBIDDEN` with the localized
  `server.error.commentsOff` ("Penulis menonaktifkan komentar di postingan ini."). The check follows the visibility check,
  so a hidden post still answers `NOT_FOUND`.
- The author can still comment and reply on their own post, to have the last word in a thread they are closing.
- Existing comments stay readable (`comments`, `commentReplies` are unchanged) and `deleteComment` works as before.
- Turning comments back on re-opens the post to everyone; nothing is lost in between.

## Attachments

`addComment.attachment` is `{ kind: 'image', photoId }` or `{ kind: 'workout' | 'food' | 'weight' | 'recap' | 'route', refId }`.

| kind | refId | source | Strava rows |
|---|---|---|---|
| `workout` | `exercise_log.id` | diary workout (watch workouts mirrored as `watch:<start>` get distance, sport, avg HR) | refused |
| `food` | `plate.id` (whole meal) or `food_log.id` | food log rows | n/a |
| `weight` | `weight_log.id` | weigh-in, with the change since the plan began | n/a |
| `recap` | a `YYYY-MM-DD` of the week | the weekly recap | n/a |
| `route` | watch workout `start` (unix s) | JoyoFit cloud workout with GPS | n/a |

The server reads the item on the commenter's own account when the comment is written (anything not theirs is
`NOT_FOUND`) and stores a snapshot in `post_comment.attachment_json`. Viewers get only that snapshot:

```
Attachment = { kind, title, date, mapLine, hasPhoto, stats }
```

- `stats` per kind: workout `{durationMin,kcal,distanceM,sportKind,avgHr}`, route `{distanceM,durationMin,sportKind}`,
  food `{kcal,protein,carbs,fat,meal,items}`, weight `{weightKg,deltaKg}`, recap
  `{weekStart,weekEnd,avgKcal,targetKcal,daysOnTarget,loggedDays,streakDays,exerciseMin,weightChangeKg}`.
  Any key can be null or missing. `packages/api/src/lib/comment-attachment-view.ts` turns them into the ordered fact
  lines every client shows (`attachmentFacts`); the clients translate `comments.fact.<key>` in the `feed` namespace.
- Never present: the source row id, a plate's coordinates, a route other than the privacy-trimmed `mapLine` (first and
  last 200 m cut, at most 100 points, same as feed posts). A `route` needs the account's map switch
  (`profile.shareMaps`); with it off `addComment` answers `NOT_FOUND` and the picker answers `notice: 'mapOff'`.
- Photos: `uploadCommentPhoto` checks the bytes really are the declared type and strips EXIF, XMP, IPTC and comments
  (`lib/image-clean.ts`); stored at `comments/<userId>/<photoId>.jpg`. A photo attaches once and only for its
  uploader. `GET /comment-photo/<commentId>` serves an image comment's photo, or a copy of an attached meal's photo
  (`hasPhoto`; the private diary original is never served: `addComment` stores a metadata-free copy under
  `comments/<userId>/`, and a photo that is not a cleanable JPEG/WebP is left off), under the visibility of the post
  the comment sits on, with `nosniff`. Bytes after the JPEG end marker are cut. Photos are removed with the comment, with the
  post, and with the account (`privacy.ts`). There is no automated moderation: reports (`social.report`) are the only
  hook.

## Notifications

A reply notifies the person answered (`kind: 'reply'`, push "{name} membalas komentarmu"); the post's author is
notified of the comment (`kind: 'comment'`) unless they are the person answered. No notification to yourself. `excerpt`
is the text, null for an attachment-only comment. Clients that do not know `reply` fall back to comment styling.

## Storage

Migration `0051_social_comment_threads`: `post_comment.parent_id` (cascade), `reply_to_user_id` (set null),
`attachment_json`, `deleted_at`, index `(parent_id, created_at)`; `social_notification.kind` gains `reply` (no schema
change, the column is plain text).
