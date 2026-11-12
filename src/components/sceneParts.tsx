// The drawn scenes' shared pieces (the empty pane's scenes and the Settings
// banners): a soft cloud, a twinkling star, and Tesven's flat-top hexagon
// plate, painted by the `.sc-*` token classes in app.css, so none holds a
// color.

export const cloud = (x: number, y: number, s = 1) => (
  <g className="sc-cloud" transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="0" rx="34" ry="10" />
    <ellipse cx="-20" cy="2" rx="20" ry="8" />
    <ellipse cx="16" cy="-5" rx="22" ry="10" />
  </g>
);

export const star = (x: number, y: number, r = 1.6, delay = 0) => (
  <circle className="sc-star" cx={x} cy={y} r={r} style={{ animationDelay: `${delay}s` }} />
);

/** A flat-top hexagon centred on (x, y) with circumradius r: Tesven's plate,
 * its seams and its geometric sun. The class picks the paint. */
export const hex = (x: number, y: number, r: number, className = "sc-paper") => {
  const h = Math.round(((r * Math.sqrt(3)) / 2) * 10) / 10;
  return (
    <path
      key={`${x}-${y}-${r}`}
      className={className}
      d={`M${x - r} ${y}l${r / 2} ${-h}h${r}l${r / 2} ${h}l${-r / 2} ${h}h${-r}z`}
    />
  );
};
