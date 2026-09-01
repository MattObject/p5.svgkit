# svgkit

SVG loading, display, and export for **p5.js 2.x**. One file, no build step,
no dependencies.

p5.js 2.x has no SVG renderer and no SVG export (the community
p5.js-svg renderer targets p5 1.x only — J. Zhu,
<https://github.com/jeffbbz/p5.js-svg>). svgkit fills that gap: load SVG
files into your sketch, draw whatever you like, and export a real
**vector SVG** — including the original vector markup of any SVG you
loaded — plus a PNG snapshot of the canvas.

## Install

```html
<script src="https://cdn.jsdelivr.net/npm/p5@2/lib/p5.min.js"></script>
<script src="p5.svgkit.js"></script>
```

Put `p5.svgkit.js` next to your sketch. Serve the folder over HTTP — any
static server works, e.g. `python3 -m http.server` or a live-reload
server. (Files loaded with `fetch()`, so opening `index.html` directly
via `file://` will not work.)

## Quick start

```js
let rec;

async function setup() {
  createCanvas(850, 1100);
  rec = svgkit.record();               // global mode; or svgkit.record(p) in instance mode

  const a = await rec.load('marks/leaf.svg');
  const b = await rec.load('marks/star.svg', { ignoreWhite: 240 });

  background(247, 246, 242);
  image(a, 80, 120, 280, 280);
  image(b, 470, 120, 280, 280);
}

function keyPressed() {
  if (key === 'e') rec.export('composition');   // writes composition.svg + composition.png
}
```

Press **e** → the browser downloads `composition.svg` (vector) and
`composition.png` (raster).

## Loading SVGs

`rec.load(path)` returns a Promise for a display-ready `p5.Image`:

- The image is **vector-registered** automatically, so `image()` calls
  carrying it are exported as real SVG markup, not rasterized pixels.
- `width`/`height` are normalized from the file's `viewBox`, so sizing in
  `image(img, x, y, w, h)` behaves predictably.
- Files may contain arbitrary transform groups (`<g>`, from Illustrator,
  Affinity, Figma, Inkscape...); transforms are respected during export.

**Options:**

| Option | What it does |
|---|---------|
| `{ whiteTransparent: N }` | Treats fills at or above RGB N (0–255, all channels) — typically the scanned paper — as **holes cut through the artwork**, so the canvas (or whatever is composited underneath) shows through them. Use `true` for the default threshold of 250. Made for traced scans: without it, deleting the paper shapes would unveil the complete dark geometry underneath as solid black. Typical value: `240`. |

Non-SVG images (`loadImage`, `gif`, jpg...) work too — they are exported
as embedded PNG `<image>` elements.

## API

| Call | What it does |
|---|---|
| `svgkit.record(p?)` | Attach a recorder. Omit `p` in global mode. **The most recent recorder is active** — with several sketches or canvases, call `record()` whenever one takes over. |
| `rec.load(path, opts?)` | Promise → display-ready, vector-registered `p5.Image`. |
| `rec.export('name')` | Downloads `name.svg` (vector) and `name.png` (raster). |
| `rec.exportSVG('x.svg')` / `rec.exportPNG('x.png')` | One format at a time. |
| `rec.svgString()` | The raw SVG markup as a string (post it to a server, save it yourself, show it in a textarea...). |
| `rec.clear()` | Start a new artwork on the same canvas: drops recorded calls, keeps vector registrations. |
| `rec.registerSvgImage(img, svgText)` | Manual registration — rarely needed; `load()` does it. |

## What gets recorded

Everything drawn also lands in the export: `background, fill, noFill,
stroke, noStroke, strokeWeight, line, rect, square, ellipse, circle,
triangle, quad, bezier, beginShape/vertex/bezierVertex/endShape, image`,
and all transforms — `push/pop/translate/rotate/scale` are **baked into
the exported coordinates**, so what you see is what the file contains.

**Text** (`text, textFont, textSize, textAlign, textStyle`) becomes real
SVG `<text>` elements with the transform matrix preserved — rotated and
scaled type survives. Two caveats:

- Fonts are referenced by name (`font-family="Georgia"`); the viewer or
  printer that opens the file must have the font. Use common system
  fonts or accept substitution.
- Text is not outlined. For print-critical work, flatten to paths in a
  vector editor before printing.

Calls the recorder cannot express (e.g. `arc`, `curveVertex`, 3D) still
draw on the canvas but are **omitted from the SVG**, with a one-time
console warning. If your export is missing something you drew, open the
browser console and look for `[svgkit]`.

## How it works

At load time, svgkit registers itself as a p5 **addon**
(`p5.registerAddon`) and wraps the drawing primitives on `p5.prototype`.
p5 2.x binds its window globals to prototype members when an instance
initializes, so one prototype-level patch covers global mode *and*
instance mode — every draw call routes through the active recorder on
its way to the real renderer. Nothing in your sketch changes; you just
draw normally.

## Known limits

- `arc()` is not recorded yet.
- p5 2.3.1 has display bugs in `bezierVertex`/`curveVertex` — prefer the
  `bezier()` form.
- Requires an HTTP-served page (no `file://`).

## Testing

Serve this folder and open `test/index.html`. Click **show svg source**
to inspect the export side by side with the canvas.
