import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/site';

// Minimal static build. Which pages exist, whether downloads are offered, and
// the canonical origin all come from src/site.ts (SITE_MODE + SITE_URL).
export default defineConfig({
  site: site.url,
  integrations: site.indexable
    ? [sitemap({ filter: (page) => page !== `${site.url}/404/` })]
    : [],
});
