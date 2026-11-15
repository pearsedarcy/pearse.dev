/**
 * Raster icons from the one SVG source (#281). This module
 * imports `sharp` and nothing from `astro:*`, so `node:test` can load it without a build. The
 * endpoints under `src/pages/` read `public/favicon.svg` and call `rasterIcon`.
 *
 * `flatten` paints the SVG's transparent pixels with the tile colour and drops the alpha channel:
 * sharp emits RGBA for a rasterised SVG, and Apple composites transparent pixels onto black.
 */
import sharp from 'sharp';

/** The lime `public/favicon.svg` fills its tile with; also the fill behind any transparent pixel. */
export const ICON_BACKGROUND = '#c6ff3d';

/** A 3-channel (opaque) PNG of `svg` at `size` x `size` pixels. */
export async function rasterIcon(svg: string | Buffer, size: number): Promise<Buffer> {
  // A high density keeps small sizes crisp: sharp rasterises the SVG at that density, then resizes.
  return sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .flatten({ background: ICON_BACKGROUND })
    .png()
    .toBuffer();
}
