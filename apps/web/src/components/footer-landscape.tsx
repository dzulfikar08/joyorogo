/**
 * Painted panorama under the public footer: the guardian cat on a mossy rock,
 * watching the sun set over the hills.
 *
 * Encoded from a 1568x588 PNG into AVIF and WebP at 800 and 1568 px wide
 * (public/landing/footer-cat-*). The cat sits right of centre, so narrow
 * screens crop toward it instead of the empty middle. The top is masked to
 * transparent so the dark sky fades out of the page background in both themes.
 */

// Below 640 px the height stays at 240 px, so object-cover draws the image 640 px wide (240 x 1568/588), wider than
// the viewport; from 640 px up the height is 37.5vw and the image is exactly the viewport wide.
const SIZES = "(max-width: 640px) 640px, 100vw";
const srcSet = (ext: string) =>
  `/landing/footer-cat-800.${ext} 800w, /landing/footer-cat-1568.${ext} 1568w`;

export function FooterLandscape() {
  return (
    <div
      aria-hidden
      className="relative h-[clamp(240px,37.5vw,588px)] w-full overflow-hidden select-none"
      style={{
        maskImage: "linear-gradient(to bottom, transparent 0, #000 45%)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent 0, #000 45%)",
      }}
    >
      <picture>
        <source type="image/avif" srcSet={srcSet("avif")} sizes={SIZES} />
        <img
          src="/landing/footer-cat-1568.webp"
          srcSet={srcSet("webp")}
          sizes={SIZES}
          alt=""
          width={1568}
          height={588}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-cover object-[82%_100%]"
        />
      </picture>
    </div>
  );
}
