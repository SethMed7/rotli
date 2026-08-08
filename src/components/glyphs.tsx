// Generic UI glyphs, collected from the approved gate frames' inline SVGs
// (r4/r5). These are chrome glyphs, not kit module icons — those live in the
// sprite and render via <Icon>.

import type { ReactNode } from "react";

import { DOCUMENT_EXTS } from "../documents/kinds";
import { IMAGE_EXTS, extOf } from "../lib/fileKind";

interface GlyphProps {
  size?: number | undefined;
  className?: string | undefined;
}

function Glyph({ size = 15, className, children }: GlyphProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Sidebar row disclosure caret — points right when collapsed, the .open class
 * rotates it down (Seth, 2026-06-13: one chevron for every expandable row). */
export function ChevronRight({ size = 10, className }: GlyphProps) {
  return (
    <Glyph size={size} className={className}>
      <path d="m9 6 6 6-6 6" />
    </Glyph>
  );
}

/** Scroll-to-top — a calm vertical arrow, distinct from disclosure chevrons. */
export function ArrowUpGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="m6 10 6-6 6 6" />
      <path d="M12 4v16" />
    </Glyph>
  );
}

/** Copy — two offset rounded rects (the universal clipboard-copy mark). Chat
 * message hover action (2026-07-30). */
export function CopyGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Glyph>
  );
}

/** Speaker — read this message aloud (voice, 2026-08-04). A cone plus one
 * sound arc; the STOP state swaps to SquareGlyph rather than a second icon. */
export function SpeakerGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </Glyph>
  );
}

/** A filled square — "stop", shared by the speaker's stop state. */
export function SquareGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Glyph>
  );
}

/** Gear — the settings mark (Breve's merged Settings section, 2026-07-30).
 * Same 1.7-stroke family: a ring + eight short spokes, no filled teeth. */
export function GearGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5" />
    </Glyph>
  );
}

/** Folder row (r1/r2 gates). */
export function FolderGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    </Glyph>
  );
}

/** New note — a page with a corner + (the VS Code "New File" title action;
 * Seth #7/#13, 2026-07-03). Same 1.7-stroke family; the plus rides the
 * bottom-right so it reads as "add a file here". */
export function NewFileGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
      <path d="M14 3v5h5" />
      <path d="M18 14.5v6M15 17.5h6" />
    </Glyph>
  );
}

/** New folder — a folder with a corner + (the VS Code "New Folder" action). */
export function NewFolderGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v3" />
      <path d="M4 7v11a2 2 0 0 0 2 2h6" />
      <path d="M18 14.5v6M15 17.5h6" />
    </Glyph>
  );
}

/** Note/file — "All notes" row + tab type glyph (r1/r2 gates). */
export function FileGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </Glyph>
  );
}

/** Office-style document — a page with readable text lines, kept generic so
 * DOCX, Pages, ODT, and RTF share one honest document family mark. */
export function DocumentGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 12h8M8 16h8" />
    </Glyph>
  );
}

/** Vault — a book (the external knowledge base the Vault row browses). Reads as a
 * "knowledge collection," not a brain, matching the renamed destination. */
export function VaultGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3" />
    </Glyph>
  );
}

/** Excalidraw board — a canvas frame with a sketch stroke (distinct from the
 * note FileGlyph so boards read as canvases in the tree + tab strip). */
export function BoardGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 15c2-4 4-4 5-2s3 1 5-3" />
    </Glyph>
  );
}

// ── real, monochrome FORMAT/BRAND marks for the file kinds. Single-path logos
// from simple-icons (CC0), filled with currentColor so they theme. We don't HIDE
// what a file is — Excalidraw reads as Excalidraw, an .svg as the SVG logo — we
// just decolorize them to match the chrome (Seth, 2026-06-29).
function BrandGlyph({ size = 15, className, path }: GlyphProps & { path: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const EXCALIDRAW_PATH =
  "M23.9428 19.8058a.1962.1962 0 0 0-.1679-.0337c-1.26-1.8552-2.8727-3.6104-4.4186-5.3152l-.2521-.284c-.0016-.0732-.0667-.1207-.1342-.1504-.0284-.0277-.0562-.0558-.0843-.0837-.0505-.1005-.1685-.1673-.2858-.1005-.4706.2347-.9068.5855-1.3274.9195-.5536.4345-1.1085.8695-1.6296 1.354a5.0577 5.0577 0 0 0-.5879.6185c-.0842.1168-.0168.2172.0843.2672-.3701.3677-.7402.736-1.109 1.1198a.1896.1896 0 0 0-.0506.1342c0 .05.0337.1.0668.1168l.6559.5012v.0169c.9237.9194 2.5538 2.1729 4.2844 3.5268.2515.201.5205.4014.7727.6017.1173.1342.2346.2847.3357.4182.0506.0662.1685.0837.2353.0331.0337.0337.0843.0668.118.1005a.2395.2395 0 0 0 .1004.0337.1534.1534 0 0 0 .1348-.0668.2371.2371 0 0 0 .0331-.1004c.0175 0 .0169.0168.0337.0168a.1915.1915 0 0 0 .1348-.0505l3.058-3.3265c.1198-.1159.0135-.2668-.0005-.2672zm-7.6277-.1336-1.5459-1.1704-.151-.0998c-.0337-.0169-.0674-.0506-.1011-.0668l-.1174-.1005c.6597-.659 1.3297-1.3074 1.9996-1.9557-.4874.4844-1.4622 1.9057-1.2606 2.3733.0023 0 .0186.0419.0674.0842.3704.311.7398.6232 1.109.9357zm4.0997 3.1261-1.277-.97a26.9056 26.9056 0 0 0-1.5795-1.5044c.689.5181 1.2769.9694 1.3611 1.053.6722.585.6379.485 1.0922.8696l.5542.4008c-.0735.103-.151.1477-.151.151zm.3357.2503-.0337-.0168c.0506-.0331.1011-.0668.1517-.1168zM.5885 3.4751c.0331.2172.0843.4344.1174.6354.2015 1.103.4031 2.1061.7726 2.8583l.1516.568c.0506.2173.1342.485.2185.5519.8568.7521 2.1674 1.8714 3.5785 2.9419a.1775.1775 0 0 0 .2185 0s0 .0162.0168.0162a.1528.1528 0 0 0 .118.0506.1912.1912 0 0 0 .1341-.0506c1.798-1.9887 3.1418-3.6267 4.0997-4.9974.0674-.0668.0843-.1673.0843-.251.0668-.0668.1173-.1504.1847-.2004.0668-.0668.0668-.184 0-.2346l-.0168-.0163c0-.033-.0169-.0836-.0506-.1005-.42-.4007-.722-.6848-1.0416-.9856A93.5546 93.5546 0 0 1 6.822 1.9876c-.0169-.0169-.0337-.0337-.0674-.0337-.3358-.1168-1.0248-.2341-1.8817-.3845C3.596 1.3527 1.865 1.0519.3027.583c0 0-.1011 0-.118.0169L.1348.6505C.0498.7139.0222.7058 0 .7167.017.8172.017.884.0506 1.0013c0 .0331.0673.3009.0673.334zm7.1909 4.7802-.0337.0337a.0362.0362 0 0 1 .0337-.0337zM6.553 2.238c.101.1005.5211.5019.6216.5855-.4369-.201-1.5284-.7022-2.0333-.8695.5043.1005 1.1933.201 1.4117.284ZM.7901 1.4027c.2521.4344.4537 1.9388.6553 3.4095-.118-.4682-.2016-.9357-.3027-1.3708C.9917 2.673.84 1.9876.6385 1.3858c.1232 0 .1516.0212.1516.0169zm-.2858-.3683c0-.0162 0-.033-.0169-.033.0843 0 .1342.0168.2016.0499.0006.0057-.1448-.0169-.1847-.0169zM23.6738.8172c.0169-.0662-.3358-.367-.2184-.3845.2527-.0163.2527-.4008 0-.4008-.3358.0169-.6884.0999-1.008.1504-.5878.1168-1.1926.2341-1.781.3671-1.327.2846-2.6375.5855-3.9481.937-.4032.1167-.857.2003-1.2432.4007-.1348.0668-.118.2004-.0506.284-.0337.0169-.0505.0169-.0842.0337-.1174.0169-.2185.0337-.3358.05-.1011.0168-.1516.1004-.1348.201 0 .0162.0169.0499.0169.0661-.7059.9363-1.4954 1.9226-2.3523 2.9757-.84.9694-1.7306 1.9893-2.6212 3.0424-2.8396 3.3096-6.0487 7.0705-9.5936 10.38a.1613.1613 0 0 0 0 .2341c.0169.0163.0337.0331.0506.0331-.0506.0506-.1011.0843-.1517.1336-.0337.0337-.0505.0668-.0505.1005a.364.364 0 0 0-.0668.0837c-.0674.0667-.0674.1835.0169.234.0667.0662.1847.0662.2346-.0168.0175-.0169.0175-.0337.0337-.0337a.2648.2648 0 0 1 .3701 0c.2016.2178.4032.435.588.6186l-.4201-.3508c-.0674-.0668-.1847-.05-.2347.0168-.068.0662-.0511.1835.0163.234l4.4691 3.7273c.0337.0337.0674.0337.118.0337.0505 0 .0842-.0169.1173-.0506l.101-.0999c.017.0163.05.0163.0669.0163.0505 0 .0842-.0163.118-.05 6.0486-6.0505 10.9216-10.6141 16.4997-14.6927.05-.0331.0668-.1.0668-.1505.0674 0 .118-.05.151-.1167 1.0254-3.1255 1.227-5.9007 1.2938-7.2709 0-.0579.0169-.0371.0169-.0668.0168-.0337.0168-.0505.0168-.0505a.9784.9784 0 0 0-.0668-.6186zm-10.82 4.9144c.2684-.3008.5374-.6186.8064-.9026-1.7306 2.2734-4.6033 5.7665-8.67 9.9288C7.7626 11.699 10.5517 8.54 12.854 5.7316ZM5.1414 23.4662c-.0162-.0168-.0162-.0168 0-.0168zm2.5033-2.156c.1348-.1505.2695-.284.4206-.4345 0 0 0 .0163.0168.0163-.2236.1978-.4334.4182-.4374.4182zm.6896-.6686c.0994-.0993.14-.1724.2852-.3177.9917-1.0193 2.0164-2.0393 3.058-3.0755l.0169-.0168c.2521-.2004.5542-.4177.8232-.6186a228.0627 228.0627 0 0 0-4.1833 4.0286zm6.5187-16.732c-.5543.719-1.1759 1.6716-1.697 2.4238-1.6463 2.3733-6.9393 8.1735-7.0566 8.274A1189.6473 1189.6473 0 0 1 1.26 19.204l-.1005.1005c-.0843-.1005-.0843-.251.0168-.3346 7.476-7.0037 12.0132-12.837 13.845-15.3944-.0506.1167-.0843.2166-.1685.334zm2.9064 3.4269c-.6716-.3851-.9905-.9869-.8064-1.5712l.0506-.201a.7753.7753 0 0 1 .0842-.1666c.1848-.301.4538-.5518.7564-.7023.0163 0 .0331 0 .05-.0168-.0169-.0337-.0169-.0837-.0169-.1336.0169-.1005.0843-.1673.2016-.1673.2016 0 .8238.1841 1.059.3845.0669.05.1343.1168.2017.1836.0842.1004.2184.2677.2852.4013.0337.0169.0674.1841.118.2678.0336.1336.0667.284.0505.4176-.0169.0169 0 .1167-.0169.1167a1.6055 1.6055 0 0 1-.2184.6186c-.0307.0307.0064.0119-.0505.0668-.0843.1342-.2016.251-.319.3346-.3869.2672-.8238.3508-1.2606.234-.1105-.0473-.1672-.0667-.1685-.0667zm4.3692 1.4039c0 .0168-.0168.0499 0 .0667-.0337 0-.0505.0169-.0842.0337-1.3274.9689-2.6212 1.9888-3.915 3.0256 1.109-.9868 2.218-1.9894 3.3776-2.9756.3358-.3009.5711-.6854.6379-1.1199l.1685-1.003v-.0332c.0842-.201.4032-.1173.3526.1-.0042-.0012-.1731.795-.5374 1.9057z";
const SVG_PATH =
  "M12 0c-1.497 0-2.749.965-3.248 2.17a3.45 3.45 0 00-.238 1.416 3.459 3.459 0 00-1.168-.834 3.508 3.508 0 00-1.463-.256 3.513 3.513 0 00-2.367 1.02c-1.06 1.058-1.263 2.625-.764 3.83.179.432.47.82.82 1.154a3.49 3.49 0 00-1.402.252C.965 9.251 0 10.502 0 12c0 1.497.965 2.749 2.17 3.248.437.181.924.25 1.414.236-.357.338-.65.732-.832 1.17-.499 1.205-.295 2.772.764 3.83 1.058 1.06 2.625 1.263 3.83.764.437-.181.83-.476 1.168-.832-.014.49.057.977.238 1.414C9.251 23.035 10.502 24 12 24c1.497 0 2.749-.965 3.248-2.17a3.45 3.45 0 00.238-1.416c.338.356.73.653 1.168.834 1.205.499 2.772.295 3.83-.764 1.06-1.058 1.263-2.625.764-3.83a3.459 3.459 0 00-.834-1.168 3.45 3.45 0 001.416-.238C23.035 14.749 24 13.498 24 12c0-1.497-.965-2.749-2.17-3.248a3.455 3.455 0 00-1.414-.236c.357-.338.65-.732.832-1.17.499-1.205.295-2.772-.764-3.83a3.513 3.513 0 00-2.367-1.02 3.508 3.508 0 00-1.463.256c-.437.181-.83.475-1.168.832a3.45 3.45 0 00-.238-1.414C14.749.965 13.498 0 12 0zm-.041 1.613a1.902 1.902 0 011.387 3.246v3.893L16.098 6A1.902 1.902 0 1118 7.902l-2.752 2.752h3.893a1.902 1.902 0 110 2.692h-3.893L18 16.098A1.902 1.902 0 1116.098 18l-2.752-2.752v3.893a1.902 1.902 0 11-2.692 0v-3.893L7.902 18A1.902 1.902 0 116 16.098l2.752-2.752H4.859a1.902 1.902 0 110-2.692h3.893L6 7.902A1.902 1.902 0 117.902 6l2.752 2.752V4.859a1.902 1.902 0 011.305-3.246z";
const PDF_PATH =
  "M23.63 15.3c-.71-.745-2.166-1.17-4.224-1.17-1.1 0-2.377.106-3.761.354a19.443 19.443 0 0 1-2.307-2.661c-.532-.71-.994-1.49-1.42-2.236.817-2.484 1.207-4.507 1.207-5.962 0-1.632-.603-3.336-2.342-3.336-.532 0-1.065.32-1.349.781-.78 1.384-.425 4.4.923 7.381a60.277 60.277 0 0 1-1.703 4.507c-.568 1.349-1.207 2.733-1.917 4.01C2.834 18.53.314 20.34.03 21.758c-.106.533.071 1.03.462 1.42.142.107.639.533 1.49.533 2.59 0 5.323-4.188 6.707-6.707 1.065-.355 2.13-.71 3.194-.994a34.963 34.963 0 0 1 3.407-.745c2.732 2.448 5.145 2.839 6.352 2.839 1.49 0 2.023-.604 2.2-1.1.32-.64.106-1.349-.213-1.704zm-1.42 1.03c-.107.532-.64.887-1.384.887-.213 0-.39-.036-.604-.071-1.348-.32-2.626-.994-3.903-2.059a17.717 17.717 0 0 1 2.98-.248c.746 0 1.385.035 1.81.142.497.106 1.278.426 1.1 1.348zm-7.524-1.668a38.01 38.01 0 0 0-2.945.674 39.68 39.68 0 0 0-2.52.745 40.05 40.05 0 0 0 1.207-2.555c.426-.994.78-2.023 1.136-2.981.354.603.745 1.207 1.135 1.739a50.127 50.127 0 0 0 1.987 2.378zM10.038 1.46a.768.768 0 0 1 .674-.425c.745 0 .887.851.887 1.526 0 1.135-.355 2.874-.958 4.861-1.03-2.768-1.1-5.074-.603-5.962zM6.134 17.997c-1.81 2.981-3.549 4.826-4.613 4.826a.872.872 0 0 1-.532-.177c-.213-.213-.32-.461-.249-.745.213-1.065 2.271-2.555 5.394-3.904Z";

export function ExcalidrawGlyph(props: GlyphProps) {
  return <BrandGlyph {...props} path={EXCALIDRAW_PATH} />;
}
export function SvgFormatGlyph(props: GlyphProps) {
  return <BrandGlyph {...props} path={SVG_PATH} />;
}
export function PdfGlyph(props: GlyphProps) {
  return <BrandGlyph {...props} path={PDF_PATH} />;
}

/** Raster image (png/jpg/gif/webp…): the IDE-standard picture mark — a framed
 * photo with a sun + a mountain ridge. Line-art, matches the chrome glyph family. */
export function ImageGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.4" />
      <path d="M4 16.5l4.5-4 3.5 3.2 3-2.8 5 4.6" />
    </Glyph>
  );
}

/** Vision capability — used where a model can inspect image attachments. */
/* — the System browser's view-switcher family (Seth, 2026-07-28: "the proper
   icons people are used to" — Finder's icon/list/columns/gallery marks) — */
export function GridViewGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Glyph>
  );
}
export function ListViewGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
      <path d="M9 6h10.5M9 12h10.5M9 18h10.5" />
    </Glyph>
  );
}
export function ColumnsViewGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M9.2 5v14M14.8 5v14" />
    </Glyph>
  );
}
export function GalleryViewGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="4" width="17" height="11.5" rx="2" />
      <path d="M5.5 19.5h.01M10 19.5h.01M14.5 19.5h.01M19 19.5h.01" />
    </Glyph>
  );
}

export function EyeGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M2.8 12s3.2-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.4" />
    </Glyph>
  );
}

/** Breve workspace lens — the familiar coffee cup, kept in the same quiet
 * currentColor/1.7-stroke grammar as every sidebar tool. */
export function CoffeeGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 8h13v5a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6Z" />
      <path d="M17 10h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M7 2.5c-1 1-.8 2 .2 3M11 2.5c-1 1-.8 2 .2 3M4 21h15" />
    </Glyph>
  );
}

/** The row glyph for a note/board/file, by kind + filename extension: the REAL
 * format mark for files (svg/pdf/raster image) and the Excalidraw logo for
 * canvases; notes and unknown files stay the generic document. */
export function glyphForNote(
  note: { kind?: "note" | "board" | "file" | undefined; title?: string | undefined },
  props?: GlyphProps,
): ReactNode {
  if (note.kind === "board") return <ExcalidrawGlyph {...props} />;
  if (note.kind === "file") {
    const ext = extOf(note.title ?? "");
    if (ext === "svg") return <SvgFormatGlyph {...props} />;
    if (ext === "pdf") return <PdfGlyph {...props} />;
    if (DOCUMENT_EXTS.has(ext)) return <DocumentGlyph {...props} />;
    if (IMAGE_EXTS.has(ext)) return <ImageGlyph {...props} />;
  }
  return <FileGlyph {...props} />;
}

/** A padlock — closed (locked) or open (the shackle lifted = unlocked). */
export function LockGlyph({ open = false, ...props }: GlyphProps & { open?: boolean }) {
  return (
    <Glyph {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.6-1.8" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </Glyph>
  );
}

/** A checkbox square with a check — the Tasks smart view (2026-07-25). */
export function TaskGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.6 12.4l2.4 2.4 4.6-5.2" />
    </Glyph>
  );
}

/** A shield with a check — the per-note "secure" flag (secrets detected). */
export function ShieldGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" />
      <path d="M9.2 12l1.9 1.9L15 10" />
    </Glyph>
  );
}

/** A properties/metadata list — dotted rows (opens the metadata panel). */
export function MetaGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="6" cy="7" r="1" />
      <path d="M10 7h8" />
      <circle cx="6" cy="12" r="1" />
      <path d="M10 12h8" />
      <circle cx="6" cy="17" r="1" />
      <path d="M10 17h8" />
    </Glyph>
  );
}

/** "Recent" row (r1/r2 gates). */
export function ClockGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Glyph>
  );
}

/** The Librarian's journal — a quiet pulse line. (Recent keeps the clock; one
 * icon per meaning, slice 5 2026-07-28.) */
export function ActivityGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </Glyph>
  );
}

/** New folder / new tab (r1/r2 gates). */
export function PlusGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}

/** Filter field magnifier (r2 gate). */
export function SearchGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Glyph>
  );
}

/** Open an external website in the system browser. */
export function ExternalLinkGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M17 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5" />
    </Glyph>
  );
}

/** Tab close (r2 gate). */
export function XGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Glyph>
  );
}

/** A star — the Quick-access marker. `filled` paints it in (starred); hollow =
    not starred. currentColor for both stroke and fill so it themes. */
export function StarGlyph({ size = 15, className, filled = false }: GlyphProps & { filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8Z" />
    </svg>
  );
}

/** A pin (thumbtack) — the "pinned to top" marker. `filled` paints the head in.
    currentColor throughout so it themes with the row. */
export function PinGlyph({ size = 14, className, filled = false }: GlyphProps & { filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4h6M10 4l-.7 6L6 13h12l-3.3-3-.7-6M12 13v7" />
    </svg>
  );
}

/** Split-right palette row (r3 frame F). */
export function SplitGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </Glyph>
  );
}

/** Titlebar "split right" — rounded rect, VERTICAL center divider = two
 *  columns. Standalone (not the shared Glyph) but matched to the line-glyph
 *  grammar: strokeWidth 1.7, round joins (Seth, 2026-06-15: one weight across
 *  the titlebar). */
export function SplitRightGlyph({ size = 16, className }: GlyphProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.6" />
      <path d="M12 4.2v15.6" />
    </svg>
  );
}

/** Titlebar "split down" — rounded rect, HORIZONTAL center divider = two
 *  rows. Same standalone shape as SplitRightGlyph (Seth, 2026-06-15). */
export function SplitDownGlyph({ size = 16, className }: GlyphProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.6" />
      <path d="M3.2 12h17.6" />
    </svg>
  );
}

/** Unified sidebar toggle (Seth, 2026-06-13) — rounded rect with a filled
 *  left column, reading as "side panels". Lives inline left of the note-list
 *  filter; the one control that hides/shows both rails with memory. */
export function SidebarGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M5.5 8.5h1M5.5 12h1" />
    </Glyph>
  );
}

/** Focus-mode corners (r3 frame F). */
export function FocusGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </Glyph>
  );
}

/** Settings → Hotkeys nav row (r1 frame F). */
export function KeyboardGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15h10" />
    </Glyph>
  );
}

/** Settings → Appearance nav row (r1 frame F). */
export function SunGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </Glyph>
  );
}

/** Settings → Storage nav row (r1 frame F). */
export function DatabaseGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5V12c0 1.7 3.6 3 8 3s8-1.3 8-3V5.5" />
      <path d="M4 12v6.5c0 1.7 3.6 3 8 3s8-1.3 8-3V12" />
    </Glyph>
  );
}

/** "This Mac" storage card (r1 frame F). */
export function LaptopGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="2" y="14" width="20" height="6" rx="2" />
      <path d="M6 14V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8" />
      <path d="M6 17h.01M10 17h.01" />
    </Glyph>
  );
}

/** Cloud storage cards (r1 frame F). */
export function CloudGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.7 3.8 3.8 0 0 0 6 20h11.5Z" />
    </Glyph>
  );
}

/** Active-storage check (r1 frame F; clay circle per the r2 clay-budget call). */
export function CheckGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="m4 12.5 5 5L20 6.5" />
    </Glyph>
  );
}

/* — destination row icons (Seth, 2026-06-13): the five reserved roots in the
   unified sidebar — Inbox (tray), Brain (head), Storage (database, reused),
   Archive (box), Trash (bin). currentColor only, no hex. — */

/** Inbox destination — a tray with the incoming notch. */
export function InboxGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 13h4l1.5 2.5h5L16 13h4" />
      <path d="M5.5 5.5 4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4l-1.5-7.5A2 2 0 0 0 16.6 4H7.4a2 2 0 0 0-1.9 1.5Z" />
    </Glyph>
  );
}

/** Storage destination — reuses the database barrel (matches Settings). */
export function StorageGlyph(props: GlyphProps) {
  return <DatabaseGlyph {...props} />;
}

/** Archive destination — a lidded box with a pull slot. */
export function ArchiveGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </Glyph>
  );
}

/** Trash destination — a bin with lid + two staves. */
export function TrashGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
      <path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7" />
      <path d="M10 11v6M14 11v6" />
    </Glyph>
  );
}

/** Chat section header — a rounded speech bubble. */
export function ChatGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V7a2 2 0 0 1 2-2Z" />
    </Glyph>
  );
}

/** The HOME front's mark (Seth's IA, 2026-08-01) — a plain house. Home is the
 * notes world today and a dashboard eventually, so the glyph says "where you
 * land", not "notes" (the stacked-pages mark still labels the Library row). */
export function HomeGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z" />
      <path d="M9.5 20.5v-6h5v6" />
    </Glyph>
  );
}

/** Notes section header — a stacked-pages mark (the corpus). */
export function NotesStackGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8 4h7l4 4v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M14.5 4v4.5H19" />
      <path d="M5 8v11a2 2 0 0 0 2 2h8" opacity="0.55" />
    </Glyph>
  );
}
