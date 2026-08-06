import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Minimal static build. rotli's marketing site is a single calm landing page.
export default defineConfig({
  site: 'https://rotli.app',
  integrations: [sitemap({ filter: (page) => page !== 'https://rotli.app/404/' })],
});
