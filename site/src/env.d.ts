/// <reference path="../.astro/types.d.ts" />

// WebMCP's declarative form attributes (the footer sign-up, SiteFooter.astro): a W3C Web
// Machine Learning group draft that browsers without it ignore.
declare namespace astroHTML.JSX {
  interface FormHTMLAttributes {
    toolname?: string;
    tooldescription?: string;
  }
  interface InputHTMLAttributes {
    toolparamdescription?: string;
  }
}
