// Ghost cables: a USB-C plug in each host port and a 3.5 mm TRS plug in each MIDI jack,
// drawn as light, not as matter. They slide in at the end of the stage and fade when the
// sections arrive.
//
// Positions in mm in the model frame (x along the board, y up, z across), measured on the
// board mesh: the USB-C receptacle faces stand at x = -1.45 and L + 1.45, centred on
// y 4.22, z 26 (Y_MOD); the jack noses at x = -2.5 and L + 2.5, centred on y 3.59, z 8
// (Y_JACK). The frame's port wells (build_shell.py) are centred on the same lines, so a
// plug seated against the socket face sits in its well.
import * as THREE from "three";

const L = 59.3;
const USB = { y: 4.22, z: 26, face: 1.45 };
const JACK = { y: 3.59, z: 8, face: 2.5 };

const COPPER = new THREE.Color(0xd1916b);
const PALE = new THREE.Color(0xf4eee8);

const vert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying float vU;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    vU = uv.x;
    gl_Position = projectionMatrix * mv;
  }
`;
const frag = /* glsl */ `
  uniform vec3 uBody;
  uniform vec3 uRim;
  uniform float uOpacity;
  uniform float uFade; // 1 on a cable: it fades out along its length
  varying vec3 vN;
  varying vec3 vV;
  varying float vU;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(f, 2.6);
    vec3 c = uBody * 0.05 + uRim * rim * 0.62;
    float a = uOpacity * mix(1.0, 1.0 - smoothstep(0.08, 0.95, vU), uFade);
    c *= a;
    // light, not paint: on the see-through canvas the alpha carries as much as the colour adds
    gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
  }
`;

function ghost(fade: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uBody: { value: COPPER.clone() },
      uRim: { value: PALE.clone().lerp(COPPER, 0.3) },
      uOpacity: { value: 0 },
      uFade: { value: fade ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
  });
}

// a rounded rectangle w x h, radius r, in the shape's xy plane
function roundRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return s;
}

// a prism of a rounded rectangle along +x, from x0 to x1, soft edged by bevel b
function block(w: number, h: number, r: number, x0: number, x1: number, b = 0) {
  const g = new THREE.ExtrudeGeometry(roundRect(w - 2 * b, h - 2 * b, Math.max(0.05, r - b)), {
    depth: x1 - x0 - 2 * b,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 3,
    curveSegments: 10,
  });
  g.translate(0, 0, b);
  g.rotateY(Math.PI / 2); // extrusion z to +x
  g.translate(x0, 0, 0);
  return g;
}

// a solid of revolution about x: [radius, x] pairs
function lathe(profile: [number, number][], seg = 40) {
  const g = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), seg);
  g.rotateZ(-Math.PI / 2); // lathe y to +x
  return g;
}

// the cable: out of the plug's back at x0, along -x, then bending down and to one side
function cable(x0: number, radius: number, side: number, drop: number) {
  const pts = [
    new THREE.Vector3(x0, 0, 0),
    new THREE.Vector3(x0 - 6, 0, 0),
    new THREE.Vector3(x0 - 16, -1.5 - drop * 0.1, side * 2),
    new THREE.Vector3(x0 - 26, -6 - drop * 0.4, side * 5),
    new THREE.Vector3(x0 - 33, -14 - drop, side * 7),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  return new THREE.TubeGeometry(curve, 72, radius, 16, false);
}

type Plug = {
  obj: THREE.Group;
  seatX: number; // x of the plug's front face, seated
  dir: number; // +1: goes in along +x
  window: [number, number];
  mats: THREE.ShaderMaterial[];
  seated: boolean;
  settleAt: number;
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const TRAVEL = 26; // mm out from seated when it appears
const MOUTH = 0.7; // mm from seated where the contacts take it: the last bit is the click
const GLIDE = 0.8; // share of the window spent gliding to the mouth
const SETTLE_MS = 380;

export class GhostCables {
  readonly group = new THREE.Group();
  private plugs: Plug[] = [];
  private shown = false;

  constructor() {
    this.group.name = "ghost_cables";
    this.group.visible = false;
    this.group.renderOrder = 3;

    // USB-C: an 8.3 x 2.5 mm shell, 6.6 mm long, in an overmold 12 x 6.5 x 20 mm and a
    // short strain relief, a 3.4 mm cable
    const usbShell = block(8.3, 2.5, 1.25, 0, 6.6);
    const usbMold = block(12, 6.5, 2.4, -20, 0, 0.8);
    const usbRelief = lathe([[0, -20.2], [2.6, -20.2], [2.5, -21.5], [2.05, -25.5], [1.85, -27], [0, -27]]);
    // TRS: tip, ring and sleeve on a 3.5 mm pin with two insulator bands, in a 6 mm barrel
    const R = 1.75, ins = 1.62;
    const trsPin = lathe([
      [0, 0], [R, 0], [R, 6.4], // sleeve
      [ins, 6.5], [ins, 7.9], // insulator
      [R, 8.0], [R, 10.3], // ring
      [ins, 10.4], [ins, 11.6], // insulator
      [R, 11.7], [R, 12.5], [1.25, 12.9], [1.25, 13.3], [R, 13.6], // tip and its detent groove
      [1.55, 14.4], [1.0, 14.9], [0.45, 15.1], [0, 15.15],
    ]);
    const trsBody = lathe([
      [0, 0], [2.4, 0], [2.85, -0.35], [3.0, -1.0], [3.0, -13], [2.8, -13.6], // barrel
      [2.25, -14.2], [2.0, -17.5], [1.75, -20.5], [0, -20.5], // strain relief
    ]);

    const add = (seatX: number, dir: number, y: number, z: number, parts: THREE.BufferGeometry[], cab: THREE.BufferGeometry, window: [number, number]) => {
      const obj = new THREE.Group();
      obj.position.set(seatX, y, z);
      if (dir < 0) obj.rotation.y = Math.PI;
      const body = ghost(false), wire = ghost(true);
      for (const g of parts) obj.add(new THREE.Mesh(g, body));
      obj.add(new THREE.Mesh(cab, wire));
      this.group.add(obj);
      this.plugs.push({ obj, seatX, dir, window, mats: [body, wire], seated: false, settleAt: -1 });
    };
    // side: the cables all bend toward the SW2 edge (+z in the model); turned by pi, the
    // far end's local z points the other way
    add(-USB.face, 1, USB.y, USB.z, [usbShell, usbMold, usbRelief], cable(-27, 1.7, 1, 0), [0.8, 0.875]);
    add(L + USB.face, -1, USB.y, USB.z, [usbShell, usbMold, usbRelief], cable(-27, 1.7, -1, 0), [0.81, 0.885]);
    add(-JACK.face, 1, JACK.y, JACK.z, [trsPin, trsBody], cable(-20.5, 1.5, 1, 3), [0.815, 0.89]);
    add(L + JACK.face, -1, JACK.y, JACK.z, [trsPin, trsBody], cable(-20.5, 1.5, -1, 3), [0.825, 0.9]);
  }

  /** Place the plugs for this progress and shift. True while something still moves. */
  update(progress: number, shift: number, now: number): boolean {
    const away = 1 - smooth(clamp(shift * 3)); // gone in the first third of the move aside
    let moving = false;
    let any = false;
    for (const p of this.plugs) {
      const t = span(progress, p.window[0], p.window[1]);
      // a steady push that slows at the mouth, then the click: a short, quick push home
      let d: number;
      if (t < GLIDE) {
        d = MOUTH + (TRAVEL - MOUTH) * (1 - easeInOut(t / GLIDE));
      } else {
        const c = (t - GLIDE) / (1 - GLIDE);
        d = MOUTH * (1 - c * c * c);
      }
      // the settle: once home, a small damped spring back off the detent
      const seated = t >= 1;
      if (seated && !p.seated) p.settleAt = now;
      p.seated = seated;
      if (seated && p.settleAt >= 0) {
        const s = (now - p.settleAt) / SETTLE_MS;
        if (s < 1) {
          d += 0.22 * Math.exp(-4.5 * s) * Math.sin(s * Math.PI * 2.5);
          moving = true;
        } else p.settleAt = -1;
      }
      p.obj.position.x = p.seatX - p.dir * d;
      const a = smooth(clamp(t / 0.35)) * away;
      p.obj.visible = a > 0.002;
      if (p.obj.visible) any = true;
      p.mats[0].uniforms.uOpacity.value = a;
      p.mats[1].uniforms.uOpacity.value = a;
    }
    if (any !== this.shown) moving = true; // one more frame to clear them
    this.shown = any;
    this.group.visible = any;
    return moving;
  }
}
