// Builds the web model of H2H: the KiCad board, the two plates with their art, and the
// printed case, in one GLB.
//
//   node assemble.mjs <work dir> <out.glb> <parts.json>
//
// <work dir> holds what the private build script made:
//   kicad/board.glb                  kicad-cli pcb export glb of the board, parts and copper
//   kicad/plate-top.glb, plate-bottom.glb   the plates' bodies (--board-only)
//   tex/<plate>-<F|B>.png, -mr.png   the plates' faces, from plates.mjs; tex/plates.json
//   case/*.stl, case/parts.json      the case parts in the board's STEP frame (export_case.py)
//
// Frames. kicad-cli writes metres, y up, x along the board and z = KiCad y (down the page),
// with the origin at the board's top left corner (--user-origin 100x100mm). That is the
// frame of the GLB. The case STLs are in the STEP frame, mm, z up and y = -(KiCad y), so a
// STEP point (x, y, z) is the GLB point (x, z, -y) / 1000.
//
// What it does:
//  1. The board keeps KiCad's colours. Its parts lose their names and join into one mesh per
//     material under one node, "Board".
//  2. Each plate is rebuilt as three primitives: the outer face with its art, the inner face
//     with its art, and the edge. The faces get UVs from the plate's outline box, which is the
//     page of the SVG plots. The top plate sits on the standoffs (7 mm); the bottom plate is
//     turned over about the short axis, its art face down, as it is built.
//  3. The case parts come in as named nodes without normals: the page computes creased normals.
//  4. Each node's origin goes to the centre of its box, so a part can turn on its own centre.
//  5. Quantize, meshopt, WebP textures.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, join, weld, quantize, reorder, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [WORK, OUT, PARTS] = process.argv.slice(2);
if (!WORK || !OUT || !PARTS) throw new Error('usage: assemble.mjs <work dir> <out.glb> <parts.json>');

const L = 59.3, W = 38.5;              // board, mm (board_geometry.py)
const SPACER_H = 7.0, PLATE_T = 1.6;   // the plates sit on 7 mm standoffs, both 1.6 mm thick
const LEDS = [                         // LED windows in the top plate, KiCad mm (measured in the art)
  { name: 'LED_blue', x: 19.6, y: 25.97, d: 3.55 },
  { name: 'LED_red', x: 39.67, y: 25.97, d: 3.55 },
];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// ---- 1. the board -----------------------------------------------------------
const doc = await io.read(path.join(WORK, 'kicad/board.glb'));
const root = doc.getRoot();
const scene = root.listScenes()[0];
const [boardNode] = scene.listChildren();
boardNode.setName('Board');
const buffer = root.listBuffers()[0];
// every mesh straight under Board, its transform baked into fresh vertex data (KiCad's model
// nodes nest rotations and scales; a decomposed matrix with a shear would come out wrong)
const meshNodes = [];
boardNode.traverse((n) => n !== boardNode && n.getMesh() && meshNodes.push([n, n.getWorldMatrix()]));
for (const [n, m] of meshNodes) {
  // normals go through the inverse transpose of the upper 3x3
  const a = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const det = a[0] * (a[4] * a[8] - a[5] * a[7]) - a[3] * (a[1] * a[8] - a[2] * a[7]) + a[6] * (a[1] * a[5] - a[2] * a[4]);
  const inv = [
    (a[4] * a[8] - a[5] * a[7]) / det, (a[2] * a[7] - a[1] * a[8]) / det, (a[1] * a[5] - a[2] * a[4]) / det,
    (a[5] * a[6] - a[3] * a[8]) / det, (a[0] * a[8] - a[2] * a[6]) / det, (a[2] * a[3] - a[0] * a[5]) / det,
    (a[3] * a[7] - a[4] * a[6]) / det, (a[1] * a[6] - a[0] * a[7]) / det, (a[0] * a[4] - a[1] * a[3]) / det,
  ];
  const mesh = doc.createMesh('');
  for (const p of n.getMesh().listPrimitives()) {
    const q = doc.createPrimitive().setMaterial(p.getMaterial()).setMode(p.getMode());
    const idx = p.getIndices();
    if (idx) q.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx.getArray().slice()).setBuffer(buffer));
    const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL');
    const P = new Float32Array(pos.getCount() * 3), N = nor ? new Float32Array(nor.getCount() * 3) : null, v = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, v);
      for (let k = 0; k < 3; k++) P[i * 3 + k] = m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k];
      if (N) {
        nor.getElement(i, v);
        // (M^-1)^T applied to v: row k of the transpose is column k of the inverse
        const w = [0, 1, 2].map((k) => inv[k * 3] * v[0] + inv[k * 3 + 1] * v[1] + inv[k * 3 + 2] * v[2]);
        const l = Math.hypot(...w) || 1;
        for (let k = 0; k < 3; k++) N[i * 3 + k] = w[k] / l;
      }
    }
    q.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buffer));
    if (N) q.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer));
    // a mirrored model (negative determinant) turns its faces inside out: flip the winding
    if (det < 0) {
      const I = q.getIndices();
      if (I) { const arr = I.getArray(); for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; } }
    }
    mesh.addPrimitive(q);
  }
  boardNode.addChild(doc.createNode('').setMesh(mesh));
}
for (const [n] of meshNodes) n.dispose();
for (const n of [...boardNode.listChildren()]) if (!n.getMesh()) n.dispose();
for (const m of root.listMaterials()) m.setName('');

// ---- helpers ---------------------------------------------------------------
function addMesh(name, positions, { uvs = null, normals = null, material = null, parent = scene } = {}) {
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer));
  if (normals) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer));
  if (uvs) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer));
  if (material) prim.setMaterial(material);
  return prim;
}
function nodeWith(name, prims) {
  const mesh = doc.createMesh(name);
  for (const p of prims) mesh.addPrimitive(p);
  const node = doc.createNode(name).setMesh(mesh);
  scene.addChild(node);
  return node;
}
// world-space triangles of a document (no rotation in kicad-cli's plate files, but keep it general)
function triangles(src) {
  const out = [];
  for (const n of src.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const m = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      const idx = p.getIndices();
      const count = idx ? idx.getCount() : pos.getCount();
      const v = [0, 0, 0];
      for (let i = 0; i < count; i++) {
        pos.getElement(idx ? idx.getScalar(i) : i, v);
        out.push(
          m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
          m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
          m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        );
      }
    }
  }
  return out;
}
async function texture(file, mime = 'image/png') {
  return doc.createTexture(path.basename(file)).setImage(fs.readFileSync(file)).setMimeType(mime);
}

// ---- 2. the plates ----------------------------------------------------------
const plateMeta = JSON.parse(fs.readFileSync(path.join(WORK, 'tex/plates.json'), 'utf8'));
const edgeMat = doc.createMaterial('Plate_edge').setBaseColorFactor([0.1, 0.095, 0.08, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
for (const plate of ['top', 'bottom']) {
  const src = await io.read(path.join(WORK, `kicad/plate-${plate}.glb`));
  const tris = triangles(src);                         // metres
  let x0 = Infinity, z0 = Infinity, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < tris.length; i += 3) {
    x0 = Math.min(x0, tris[i]); z0 = Math.min(z0, tris[i + 2]);
    yMin = Math.min(yMin, tris[i + 1]); yMax = Math.max(yMax, tris[i + 1]);
  }
  const [wmm, hmm] = plateMeta[plate].mm;
  const t = yMax - yMin;
  const sy = PLATE_T / 1000 / t;                       // kicad-cli draws the body 1.51 mm thick
  const face = { F: [[], []], B: [[], []], E: [[], [], []] }; // positions, uvs (faces); positions, normals (edge)
  for (let i = 0; i < tris.length; i += 9) {
    const a = tris.slice(i, i + 3), b = tris.slice(i + 3, i + 6), c = tris.slice(i + 6, i + 9);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const kind = ny > 0.99 ? 'F' : ny < -0.99 ? 'B' : 'E';
    for (const p of [a, b, c]) {
      // the art's UV comes from the plate as drawn, before it is placed
      const u = ((p[0] - x0) * 1000) / wmm, v = ((p[2] - z0) * 1000) / hmm;
      let x = p[0], y = (p[1] - yMin) * sy, z = p[2];
      let n = [nx, ny, nz];
      if (plate === 'top') y += SPACER_H / 1000;
      else { x = L / 1000 - x; y = -y; n = [-nx, -ny, nz]; }   // turned over about the short (z) axis
      if (kind === 'E') { face.E[0].push(x, y, z); face.E[1].push(...n); }
      else { face[kind][0].push(x, y, z); face[kind][1].push(u, v); }
    }
  }
  const prims = [];
  for (const side of ['F', 'B']) {
    const mat = doc.createMaterial(`Plate_${plate}_${side}`)
      .setBaseColorTexture(await texture(path.join(WORK, `tex/${plate}-${side}.png`)))
      .setMetallicRoughnessTexture(await texture(path.join(WORK, `tex/${plate}-${side}-mr.png`)))
      .setMetallicFactor(1).setRoughnessFactor(1);
    const normals = [];
    const up = (side === 'F') === (plate === 'top') ? 1 : -1;
    for (let k = 0; k < face[side][0].length / 3; k++) normals.push(0, up, 0);
    prims.push(addMesh('', face[side][0], { uvs: face[side][1], normals, material: mat }));
  }
  prims.push(addMesh('', face.E[0], { normals: face.E[1], material: edgeMat }));
  nodeWith(`Plate_${plate}`, prims);
  console.log(`plate ${plate}: ${tris.length / 9} triangles, ${(t * 1000).toFixed(2)} mm drawn, ${PLATE_T} mm placed`);
}

// ---- 3. the case parts -------------------------------------------------------
function readStl(file) {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(80);
  if (84 + n * 50 !== b.length) throw new Error(`${file}: not a binary STL`);
  const pos = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const o = 84 + i * 50 + 12 + k * 12;
      const x = b.readFloatLE(o), y = b.readFloatLE(o + 4), z = b.readFloatLE(o + 8);
      pos.set([x / 1000, z / 1000, -y / 1000], i * 9 + k * 3);   // STEP mm to GLB metres
    }
  }
  return pos;
}
const caseParts = JSON.parse(fs.readFileSync(path.join(WORK, 'case/parts.json'), 'utf8'));
const caseMat = doc.createMaterial('Case').setBaseColorFactor([0.03, 0.03, 0.032, 1]).setRoughnessFactor(0.7).setMetallicFactor(0);
for (const p of caseParts) nodeWith(p.name, [addMesh('', readStl(path.join(WORK, `case/${p.name}.stl`)), { material: caseMat })]);

// LED windows: a thin puck in each window, flush with the top face, that the page lights.
// It has a little height: a flat part would have an empty box, which quantizing cannot scale.
const ledMat = doc.createMaterial('LED').setBaseColorFactor([0, 0, 0, 1]).setEmissiveFactor([1, 1, 1]);
for (const led of LEDS) {
  const pos = [], normals = [], seg = 48, r = (led.d / 2 - 0.02) / 1000;
  const y1 = (SPACER_H + PLATE_T + 0.02) / 1000, y0 = y1 - 0.3 / 1000;
  const cx = led.x / 1000, cz = led.y / 1000;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
    pos.push(cx, y1, cz, p1[0], y1, p1[1], p0[0], y1, p0[1]);
    normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
    pos.push(p0[0], y1, p0[1], p1[0], y1, p1[1], p1[0], y0, p1[1], p0[0], y1, p0[1], p1[0], y0, p1[1], p0[0], y0, p0[1]);
    normals.push(...n0, ...n1, ...n1, ...n0, ...n1, ...n0);
  }
  nodeWith(led.name, [addMesh('', pos, { normals, material: ledMat })]);
}

// ---- 4. join the board, centre each node --------------------------------------
await doc.transform(dedup(), join({ keepNamed: true }), weld(), prune());
const parts = [];
for (const node of scene.listChildren()) {
  const name = node.getName();
  // bake the node's transform into its primitives, then move the origin to the box centre
  const prims = [];
  node.traverse((n) => n.getMesh() && prims.push([n, n.getMesh()]));
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const [n, mesh] of prims) {
    const m = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const w = [0, 1, 2].map((k) => m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]);
        for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
      }
    }
  }
  const c = lo.map((l, k) => (l + hi[k]) / 2);
  const t = node.getTranslation();
  if (prims.length === 1 && prims[0][0] === node && node.getRotation().every((q, k) => q === [0, 0, 0, 1][k]) && node.getScale().every((s) => s === 1)) {
    const mesh = node.getMesh();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION'), v = [0, 0, 0];
      const arr = new Float32Array(pos.getCount() * 3);
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        arr.set([v[0] + t[0] - c[0], v[1] + t[1] - c[1], v[2] + t[2] - c[2]], i * 3);
      }
      // a fresh accessor: a shared one would move other meshes too
      p.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(arr).setBuffer(buffer));
    }
    node.setTranslation(c);
  }
  let tris = 0;
  for (const [, mesh] of prims) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  parts.push({ name, tris: Math.round(tris), min: lo.map((x) => +(x * 1000).toFixed(3)), max: hi.map((x) => +(x * 1000).toFixed(3)) });
}
scene.setName('scene');

if (process.env.DEBUG_GLB) await io.write(process.env.DEBUG_GLB, doc);
// ---- 5. compress -------------------------------------------------------------
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 88 }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 14 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
fs.writeFileSync(PARTS, JSON.stringify(parts, null, 1) + '\n');
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`${OUT}: ${kb} KB, ${parts.length} parts, ${parts.reduce((a, p) => a + p.tris, 0)} triangles`);
for (const p of parts) console.log(`  ${p.name.padEnd(16)} ${String(p.tris).padStart(6)}  [${p.min.join(', ')}] .. [${p.max.join(', ')}]`);
