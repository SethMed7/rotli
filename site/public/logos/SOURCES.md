# Product marks on the landing's bench

The StatBand (`site/src/components/landing/StatBand.astro`) shows four AI
products as their own marks on a plain badge, each named under it. These files
are the marks exactly as published: never traced, redrawn, recoloured, cropped,
or edited. They are shown as images, in the single colour they are published
in, never rotated, squashed, or drawn over. The names and marks belong to
their owners, and the page says so under its sources.

| File | Product | Source | Licence of the file | Owner's usage note |
|---|---|---|---|---|
| `openai.svg` | ChatGPT (OpenAI) | OpenAI's own repository [`openai/openai-assistants-quickstart`, `public/openai.svg`, commit `15cc6234`](https://github.com/openai/openai-assistants-quickstart/blob/15cc6234edea62517d7c0fd2137450a8ea21cc50/public/openai.svg) (the Blossom, published by OpenAI) | The repository is MIT; the mark is OpenAI's trademark | [openai.com/brand](https://openai.com/brand/): use the logo only when it directly relates to OpenAI's services, exactly as provided, with no added colours, and never to imply endorsement; it asks for permission otherwise |
| `claude.svg` | Claude (Anthropic) | [simple-icons 16.34.0](https://github.com/simple-icons/simple-icons/blob/16.34.0/icons/claude.svg), `icons/claude.svg` (source: claude.ai) | CC0 1.0 (the package); the mark is Anthropic's trademark | [Anthropic trademark guidelines](https://www.anthropic.com/legal/trademark-guidelines): use only as Anthropic permits and in materials it approves beforehand; no changes to colour, font, or proportion. Its primary colour is the orange the package records (`D97757`) |
| `googlegemini.svg` | Gemini (Google) | [simple-icons 16.34.0](https://github.com/simple-icons/simple-icons/blob/16.34.0/icons/googlegemini.svg), `icons/googlegemini.svg` (source: gemini.google.com) | CC0 1.0 (the package); the mark is Google's trademark | Google's own mark is a gradient; this is simple-icons' single-colour rendering of it. Google's brand terms apply (not reviewed here) |
| `perplexity.svg` | Perplexity | [simple-icons 16.34.0](https://github.com/simple-icons/simple-icons/blob/16.34.0/icons/perplexity.svg), `icons/perplexity.svg` (source: perplexity.ai) | CC0 1.0 (the package); the mark is Perplexity's trademark | Perplexity's brand terms apply (not reviewed here); its primary colour is the turquoise the package records (`1FB8CD`) |

simple-icons states that its CC0 licence covers the package, not the brands'
rights in their marks, and asks users to follow each brand's guidelines
([DISCLAIMER](https://github.com/simple-icons/simple-icons/blob/16.34.0/DISCLAIMER.md)).
OpenAI and Anthropic both ask for permission or approval before their marks
are used in marketing; Google's and Perplexity's own brand terms were not
reviewed for this. Showing these marks on rotli.co is the owner's decision. Going
back to names alone means taking the marks out of the StatBand's `tools` list
and deleting these files.

Perplexity is the fourth because it is one of the ten paid AI services in the
Self Financial survey the band's first figure comes from.

## Checksums (SHA-256)

```text
0dd4dd71846aeb7a484acdc59eb08eac2b3c1264a143d11bca9b73e4a8cacfbf  openai.svg
2d6fda79eb18ddccca35b799eeb3cece0dfabc22520ce3b10abd25668df9fa93  claude.svg
a6228d8846040401e941a39ed17459785e8324dbb7b870ce84233c9b3e9863a0  googlegemini.svg
57220c29378ce5e615e7244d2fdfcf5a44fad40dad81a99f2e0e4260c726ca74  perplexity.svg
```
