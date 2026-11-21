// Trims and compresses the product photos (background already removed) for the page.
//
//   node tools/photos.mjs <out dir> <name>=<photo.png> ...
//
// Each photo is cut to the device (the transparent margin goes), scaled to 1400 px on its
// long side and written as WebP with alpha, plus a 700 px copy for phones.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const [OUT, ...pairs] = process.argv.slice(2);
if (!OUT || !pairs.length) throw new Error('usage: photos.mjs <out dir> <name>=<photo.png> ...');
fs.mkdirSync(OUT, { recursive: true });
const sizes = {};
for (const pair of pairs) {
  const [name, file] = pair.split(/=(.*)/s);
  const trimmed = await sharp(file).trim({ threshold: 1 }).toBuffer();
  for (const [suffix, long] of [['', 1400], ['-700', 700]]) {
    const info = await sharp(trimmed)
      .resize(long, long, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 90, effort: 6 })
      .toFile(path.join(OUT, `${name}${suffix}.webp`));
    if (!suffix) sizes[name] = [info.width, info.height];
    console.log(`${name}${suffix}.webp ${info.width} x ${info.height}, ${(info.size / 1024).toFixed(0)} KB`);
  }
}
fs.writeFileSync(path.join(OUT, 'photos.json'), JSON.stringify(sizes) + '\n');
