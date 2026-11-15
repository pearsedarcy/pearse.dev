/**
 * The web manifest (#281). Public site names and the two generated PNG icons only; `display` is
 * "browser" on purpose (no installable app, no service worker). Colours come from `SITE.themeColor`
 * so the manifest and `<meta name="theme-color">` cannot drift.
 */
import type { APIRoute } from 'astro';
import { SITE } from '../lib/site';

export const GET: APIRoute = () => {
  const body = {
    name: SITE.name,
    short_name: SITE.shortName,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    start_url: '/',
    display: 'browser',
    theme_color: SITE.themeColor,
    background_color: SITE.themeColor,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
};
