// Paints the two plates of H2H as textures, from KiCad's own layer plots.
//
//   node plates.mjs <svg dir> <out dir>
//
// <svg dir> holds one SVG per plate, side and layer, as written by
//   kicad-cli pcb export svg --mode-single --page-size-mode 2 --black-and-white --drill-shape-opt 0
// named <plate>-<layer>.svg (plate = top or bottom; layer = F.Cu, F.Mask, F.Silkscreen, B.Cu,
// B.Mask, B.Silkscreen). Page size mode 2 makes each page the board's own box, so pixel (0, 0)
// is the corner of the plate's outline box on every layer.
//
// The plates are black solder mask with white print and bare copper (OSP), so each pixel is:
//   print                          white ink
//   mask opening over copper       copper
//   mask opening, no copper        bare FR4 (the LED windows, which glow)
//   copper under the mask          a little lighter than the mask: the copper stands up
//   mask                           black
// Writes <plate>-<F|B>.png (colour) and <plate>-<F|B>-mr.png (glTF metal/roughness: copper is
// metal and smoother than the mask) for each plate and side.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [SRC, OUT] = process.argv.slice(2);
if (!SRC || !OUT) throw new Error('usage: plates.mjs <svg dir> <out dir>');
fs.mkdirSync(OUT, { recursive: true });

const PX_PER_MM = Number(process.env.PX_PER_MM || 30);
const INK = [236, 234, 228];
const COPPER = [208, 142, 116];
const FR4 = [66, 61, 48];
const RAISED = [30, 30, 31];
const MASK = [16, 16, 17];
// glTF metal/roughness: G = roughness, B = metalness
const MR = { ink: [0, 150, 0], copper: [0, 135, 230], fr4: [0, 170, 0], raised: [0, 120, 0], mask: [0, 135, 0] };

async function alpha(file, w, h) {
  if (!fs.existsSync(file)) return null;
  // the page in pixels: librsvg then draws it at 72 dpi, one SVG pixel per texture pixel
  const svg = fs.readFileSync(file, 'utf8').replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${w}" height="${h}"`);
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h) throw new Error(`${file}: ${info.width}x${info.height}, wanted ${w}x${h}`);
  return data;
}

function pageMm(file) {
  const head = fs.readFileSync(file, 'utf8').slice(0, 2000);
  const m = head.match(/width="([\d.]+)mm" height="([\d.]+)mm"/);
  if (!m) throw new Error(`${file}: no page size in mm`);
  return [Number(m[1]), Number(m[2])];
}

const meta = {};
for (const plate of ['top', 'bottom']) {
  const [wmm, hmm] = pageMm(path.join(SRC, `${plate}-F.Cu.svg`));
  const w = Math.round(wmm * PX_PER_MM), h = Math.round(hmm * PX_PER_MM);
  meta[plate] = { mm: [wmm, hmm], px: [w, h] };
  for (const side of ['F', 'B']) {
    const [cu, mask, silk] = await Promise.all(
      ['Cu', 'Mask', 'Silkscreen'].map((l) => alpha(path.join(SRC, `${plate}-${side}.${l}.svg`), w, h)),
    );
    const rgb = Buffer.alloc(w * h * 3);
    const mr = Buffer.alloc(w * h * 3);
    const mix = (a, b, t) => a + (b - a) * t;
    for (let i = 0; i < w * h; i++) {
      const c = cu ? cu[i] / 255 : 0, o = mask ? mask[i] / 255 : 0, s = silk ? silk[i] / 255 : 0;
      // under the mask: raised over copper, flat elsewhere; in an opening: copper or FR4
      const under = [0, 1, 2].map((k) => mix(MASK[k], RAISED[k], c));
      const open = [0, 1, 2].map((k) => mix(FR4[k], COPPER[k], c));
      const base = [0, 1, 2].map((k) => mix(under[k], open[k], o));
      const mUnder = [0, 1, 2].map((k) => mix(MR.mask[k], MR.raised[k], c));
      const mOpen = [0, 1, 2].map((k) => mix(MR.fr4[k], MR.copper[k], c));
      const mBase = [0, 1, 2].map((k) => mix(mUnder[k], mOpen[k], o));
      for (let k = 0; k < 3; k++) {
        rgb[i * 3 + k] = Math.round(mix(base[k], INK[k], s));
        mr[i * 3 + k] = Math.round(mix(mBase[k], MR.ink[k], s));
      }
    }
    const raw = { raw: { width: w, height: h, channels: 3 } };
    await sharp(rgb, raw).png().toFile(path.join(OUT, `${plate}-${side}.png`));
    await sharp(mr, raw).resize(Math.round(w / 2), Math.round(h / 2)).png().toFile(path.join(OUT, `${plate}-${side}-mr.png`));
    console.log(`${plate}-${side}: ${w} x ${h} px`);
  }
}
fs.writeFileSync(path.join(OUT, 'plates.json'), JSON.stringify(meta, null, 1));
