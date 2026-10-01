// /index.md: the landing page's Markdown twin, which is the llms.txt summary.
// A request for / with `Accept: text/markdown` is answered with it (site/Caddyfile).
export { GET } from './llms.txt';
