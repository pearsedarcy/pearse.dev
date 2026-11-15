/**
 * The three PNG icon endpoints share this (#281): `public/favicon.svg` is imported with Vite's
 * `?raw` (never a path relative to the endpoint, which breaks after bundling), rasterised by
 * `rasterIcon`, and served as `image/png`.
 */
import type { APIRoute } from 'astro';
import faviconSvg from '../../public/favicon.svg?raw';
import { rasterIcon } from './icons';

export function iconEndpoint(size: number): APIRoute {
  return async () => {
    const png = await rasterIcon(faviconSvg, size);
    return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
  };
}
