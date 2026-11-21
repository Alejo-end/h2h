// <h2h-device>: H2H in 3D, driven by a few numbers.
//
//   device.progress = 0..1   0 apart, then it goes together layer by layer
//   device.view = name       turns and frames the device for one section (VIEWS below)
//   device.shift = 0..1      slides it into the left half (desktop) or the top (phone)
//   device.sliders / press   the two switch sliders and the panic button
//   device.leds = fn         the colour of each status LED now (the firmware model)
//
// The model (public/model/h2h.glb) is in the board's frame: metres, x along the board
// (host blue's end at 0), y up, z across it (the TRS switch edge at 0). It comes apart the
// way it is built: on the bottom plate with its standoffs, the bottom frame goes down, then
// the board, the sliders, keys and panic cap, the top frame, the top plate and its screws.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import type { Rgb, Side } from "./h2h";

const BELOW = ["screws_bottom"] as const;
const ABOVE = ["frame_bottom", "board", "bits", "frame_top", "plate_top", "screws_top"] as const;
type Layer = (typeof BELOW)[number] | (typeof ABOVE)[number] | "base";

function layerOf(name: string): Layer {
  if (/^Screw_bottom/.test(name)) return "screws_bottom";
  if (/^Screw_top/.test(name)) return "screws_top";
  if (/^Frame_bottom/.test(name)) return "frame_bottom";
  if (/^Frame_top/.test(name)) return "frame_top";
  if (/^Board/.test(name)) return "board";
  if (/^(Slider_|Key_|Panic_cap)/.test(name)) return "bits";
  if (/^(Plate_top|LED_)/.test(name)) return "plate_top";
  return "base"; // the bottom plate and the standoffs
}
const GAP = 9; // mm of air between layers when apart
const SLIDER_TRAVEL = 1.5; // mm, end to end
const PRESS = 0.45; // mm the panic cap goes down

export type View = { tilt: number; yaw: number; zoom: number; focus: [number, number, number] };
// tilt turns the top toward you (pi/2: straight down onto the top plate), yaw turns it on the
// table (0: the SW2 edge faces you, +pi/2: host blue's end, -pi/2: host red's end, pi: the
// SW3 edge). focus is a point in mm, the
// middle of the board is [29.65, 4.3, 19.25].
const C: [number, number, number] = [29.65, 4.3, 19.25];
export const VIEWS: Record<string, View> = {
  hero: { tilt: 0.62, yaw: -0.5, zoom: 1, focus: C },
  top: { tilt: 1.15, yaw: 0, zoom: 1, focus: C },
  face: { tilt: Math.PI / 2, yaw: 0, zoom: 0.92, focus: C },
  ports: { tilt: 0.32, yaw: 1.2, zoom: 1.05, focus: [14, 3, 19.25] },
  cables: { tilt: 0.38, yaw: 0.22, zoom: 1.2, focus: [29.65, 2, 30] },
  trs: { tilt: 0.42, yaw: -Math.PI + 0.75, zoom: 1.15, focus: [44, 3, 8] },
  panic: { tilt: 0.95, yaw: -0.3, zoom: 1.25, focus: [29.65, 7, 19.25] },
  lights: { tilt: 1.3, yaw: 0, zoom: 1.15, focus: [29.65, 8.6, 22] },
  spin: { tilt: 0.5, yaw: -0.5, zoom: 0.95, focus: C },
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const span = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const land = (t: number) => 1 - Math.pow(1 - easeInOut(t), 1.6);
const P_ASM: [number, number] = [0.04, 0.7];
const P_TURN: [number, number] = [0.55, 0.92];

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

type Part = {
  obj: THREE.Object3D; // a pivot group at the part's centre
  name: string;
  layer: Layer;
  home: THREE.Vector3;
  homeQ: THREE.Quaternion;
  jitter: THREE.Euler;
  spin: number; // turns about its own axis while apart (screws)
  offset: number;
  lo: number;
  hi: number;
  window: [number, number];
};

export class H2HDevice extends HTMLElement {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 1, 5000);
  private pivot = new THREE.Group();
  private model = new THREE.Group();
  private parts: Part[] = [];
  private byName = new Map<string, Part>();
  private ledMats: Partial<Record<Side, THREE.MeshBasicMaterial>> = {};
  private glowMats: Partial<Record<Side, THREE.MeshBasicMaterial>> = {};
  private key!: THREE.DirectionalLight;
  private _progress = 0;
  private _shift = 0;
  private shiftNow = 0;
  private viewNow: View = { ...VIEWS.hero, focus: [...VIEWS.hero.focus] };
  private viewTarget: View = VIEWS.hero;
  private slidersNow = { SW2: 0, SW3: 0 };
  private slidersTarget = { SW2: 0, SW3: 0 };
  private pressNow = 0;
  private pressTarget = 0;
  private pointer = new THREE.Vector2();
  private pointerNow = new THREE.Vector2();
  private visible = true;
  private dirty = true;
  private t0 = performance.now();
  private rAssembled = 50;
  private portrait = false;
  leds: ((s: Side, now: number) => Rgb) | null = null;
  ledsAnimating: (() => boolean) | null = null;
  ready: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    super();
    this.ready = new Promise((r) => (this.resolveReady = r));
  }

  set progress(v: number) {
    const p = clamp(v);
    if (p !== this._progress) {
      this._progress = p;
      this.dirty = true;
    }
  }
  get progress() {
    return this._progress;
  }
  set shift(v: number) {
    this._shift = clamp(v);
    this.dirty = true;
  }
  set view(name: string) {
    this.viewTarget = VIEWS[name] ?? VIEWS.top;
    this.dirty = true;
  }
  /** -1..1 for each slider: -1 at the left end as you read the plate, 1 at the right. */
  setSlider(sw: "SW2" | "SW3", pos: number) {
    this.slidersTarget[sw] = clamp(pos, -1, 1);
    this.dirty = true;
  }
  press() {
    this.pressTarget = 1;
    this.dirty = true;
    setTimeout(() => ((this.pressTarget = 0), (this.dirty = true)), 140);
  }
  /** Ask for a frame: the lights changed. */
  poke() {
    this.dirty = true;
  }

  connectedCallback() {
    if (this.renderer) return;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    this.appendChild(canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      this.classList.add("no-webgl");
      this.dispatchEvent(new Event("nowebgl"));
      return;
    }
    this.renderer = renderer;
    const touch = matchMedia("(pointer: coarse)").matches;
    renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.75 : 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.7;
    const key = (this.key = new THREE.DirectionalLight(0xfff1e2, 2.6));
    key.position.set(-160, 260, 220);
    const rim = new THREE.DirectionalLight(0xffc9a8, 1.5);
    rim.position.set(240, 60, -260);
    const fill = new THREE.HemisphereLight(0xa8a29a, 0x080808, 0.4);
    this.scene.add(key, rim, fill, this.pivot);
    this.pivot.add(this.model);

    new ResizeObserver(() => this.resize()).observe(this);
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(this);
    addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      this.pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
    });
    this.load().catch((err) => {
      console.error(err);
      this.classList.add("no-webgl");
      this.dispatchEvent(new Event("nowebgl"));
    });
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.visible && this.style.opacity !== "0") this.frame();
    };
    requestAnimationFrame(loop);
  }

  private async load() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}model/h2h.glb`);
    const scene = gltf.scene;
    scene.scale.setScalar(1000); // metres to mm
    // measure at rest: the frame loop may already have turned the pivot
    this.pivot.quaternion.identity();
    this.pivot.position.set(0, 0, 0);
    this.model.position.set(0, 0, 0);
    this.model.add(scene);
    this.pivot.updateMatrixWorld(true);

    const named = [...scene.children];
    // each part hangs from a pivot at its own centre, in mm in the model frame
    for (const obj of named) {
      const name = obj.name;
      this.material(obj);
      const box = new THREE.Box3().setFromObject(obj);
      const pivot = new THREE.Group();
      pivot.name = name;
      box.getCenter(pivot.position);
      this.model.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(obj);
      const layer = layerOf(name);
      this.byName.set(name, {
        obj: pivot,
        name,
        layer,
        home: pivot.position.clone(),
        homeQ: pivot.quaternion.clone(),
        jitter: new THREE.Euler(),
        spin: 0,
        offset: 0,
        lo: box.min.y,
        hi: box.max.y,
        window: [0, 0],
      });
    }
    this.model.remove(scene);

    // layers apart: each clears the one before it by GAP, outward from the bottom plate
    const byLayer = new Map<Layer, Part[]>();
    for (const p of this.byName.values()) byLayer.set(p.layer, [...(byLayer.get(p.layer) ?? []), p]);
    const layerSpan = (l: Layer) => {
      let lo = Infinity, hi = -Infinity;
      for (const p of byLayer.get(l) ?? []) {
        lo = Math.min(lo, p.lo);
        hi = Math.max(hi, p.hi);
      }
      return [lo, hi] as const;
    };
    const offset = new Map<Layer, number>();
    const [baseLo, baseHi] = layerSpan("base");
    let edge = baseLo;
    for (const l of BELOW) {
      if (!byLayer.has(l)) continue;
      const [lo, hi] = layerSpan(l);
      offset.set(l, edge - GAP - hi);
      edge = lo + (edge - GAP - hi);
    }
    edge = baseHi;
    for (const l of ABOVE) {
      if (!byLayer.has(l)) continue;
      const [lo, hi] = layerSpan(l);
      const o = edge + GAP - lo;
      offset.set(l, o);
      edge = hi + o;
    }
    // together: one layer at a time, from the bottom plate up, then the screws underneath
    const seq: Layer[] = [...ABOVE, ...BELOW].filter((l) => byLayer.has(l));
    const windows = new Map<Layer, [number, number]>();
    seq.forEach((l, k) => windows.set(l, [k / seq.length, Math.min(1, (k + 1.35) / seq.length)]));
    let i = 0;
    for (const p of this.byName.values()) {
      const seed = Math.sin(++i * 12.9898) * 43758.5453;
      const r = (k: number) => Math.sin(seed * k);
      p.offset = offset.get(p.layer) ?? 0;
      p.window = windows.get(p.layer) ?? [0, 0];
      if (p.layer === "bits") p.jitter.set(r(1.3) * 0.4, r(2.1) * 0.7, r(3.7) * 0.4);
      if (/^Screw/.test(p.name)) p.spin = Math.PI * 4 * (p.layer === "screws_top" ? -1 : 1);
      this.parts.push(p);
    }
    this.addGlow();
    const base = this.byName.get("Frame_bottom");
    this.rAssembled = base ? new THREE.Box3().setFromObject(base.obj).getSize(new THREE.Vector3()).x / 2 + 4 : 40;

    try {
      await this.renderer!.compileAsync(this.scene, this.camera);
    } catch {
      /* a frame compiles anything left */
    }
    this.dirty = true;
    this.frame();
    requestAnimationFrame(() => this.classList.add("ready"));
    this.resolveReady();
  }

  private material(obj: THREE.Object3D) {
    const name = obj.name;
    const pla = new THREE.MeshPhysicalMaterial({ color: 0x111113, roughness: 0.74, metalness: 0, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x3a3a40) });
    const steel = new THREE.MeshPhysicalMaterial({ color: 0x1b1b1e, roughness: 0.36, metalness: 0.85, clearcoat: 0.2 });
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry as THREE.BufferGeometry;
      if (!g.getAttribute("normal")) mesh.geometry = toCreasedNormals(g, THREE.MathUtils.degToRad(32));
      if (/^Screw/.test(name)) mesh.material = steel;
      else if (/^(Frame_|Slider_|Key_|Panic_cap|Standoff_)/.test(name)) mesh.material = pla;
      else if (/^LED_/.test(name)) {
        const side: Side = /blue/.test(name) ? "blue" : "red";
        const m = new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false });
        this.ledMats[side] = m;
        mesh.material = m;
      } else {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mm of mats) {
          const s = mm as THREE.MeshStandardMaterial;
          if ("envMapIntensity" in s) s.envMapIntensity = 0.9;
          if (s.map) s.map.anisotropy = 8;
        }
      }
    });
  }

  // a soft halo over each LED window, so a lit window reads from across the room
  private addGlow() {
    const g = document.createElement("canvas");
    g.width = g.height = 128;
    const c = g.getContext("2d")!;
    const grad = c.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = grad;
    c.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(g);
    for (const side of ["blue", "red"] as Side[]) {
      const led = this.byName.get(side === "blue" ? "LED_blue" : "LED_red");
      if (!led) continue;
      const m = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.glowMats[side] = m;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), m);
      plane.rotation.x = -Math.PI / 2;
      plane.position.y = 0.05;
      plane.renderOrder = 2;
      led.obj.add(plane);
    }
  }

  private resize() {
    if (!this.renderer) return;
    const w = this.clientWidth || innerWidth;
    const h = this.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = w / h < 1;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.frame();
  }

  private frame() {
    if (!this.renderer) return;
    const now = performance.now();
    const t = (now - this.t0) / 1000;
    const p = this._progress;
    const asm = span(p, ...P_ASM);
    const turn = easeInOut(span(p, ...P_TURN));

    // ease the view, sliders and button toward their targets
    const k = 0.075;
    const v = this.viewNow, tv = this.viewTarget;
    let moving = false;
    const ease = (a: number, b: number, kk = k) => {
      const d = b - a;
      if (Math.abs(d) > 1e-4) moving = true;
      return a + d * kk;
    };
    v.tilt = ease(v.tilt, tv.tilt);
    v.yaw = ease(v.yaw, tv.yaw);
    v.zoom = ease(v.zoom, tv.zoom);
    for (let i = 0; i < 3; i++) v.focus[i] = ease(v.focus[i], tv.focus[i]);
    this.slidersNow.SW2 = ease(this.slidersNow.SW2, this.slidersTarget.SW2, 0.25);
    this.slidersNow.SW3 = ease(this.slidersNow.SW3, this.slidersTarget.SW3, 0.25);
    this.pressNow = ease(this.pressNow, this.pressTarget, 0.45);
    this.shiftNow = ease(this.shiftNow, this._shift, 0.08);

    // parts: fly home in their windows
    let lowNow = Infinity, highNow = -Infinity;
    for (const part of this.parts) {
      const [w0, w1] = part.window;
      const kk = part.offset ? land(span(asm, w0, w1)) : 1;
      const apart = 1 - kk;
      part.obj.position.copy(part.home);
      part.obj.position.y += part.offset * apart;
      lowNow = Math.min(lowNow, part.lo + part.offset * apart);
      highNow = Math.max(highNow, part.hi + part.offset * apart);
      if (part.name === "Slider_SW2" || part.name === "Slider_SW3") {
        // both switches read left to right as you look onto the top plate: x grows to the right
        const s = part.name === "Slider_SW2" ? this.slidersNow.SW2 : this.slidersNow.SW3;
        part.obj.position.x += (s * SLIDER_TRAVEL) / 2;
      }
      if (part.name === "Panic_cap") part.obj.position.y -= this.pressNow * PRESS;
      const turnK = apart * apart;
      part.obj.quaternion
        .copy(part.homeQ)
        .multiply(_q.setFromEuler(_e.set(part.jitter.x * turnK, part.jitter.y * turnK + part.spin * turnK, part.jitter.z * turnK)));
    }
    if (!this.parts.length) lowNow = highNow = 0;

    // the stack: centred on the focus point once together, on its own middle while apart
    const apartK = 1 - asm;
    const fx = v.focus[0], fz = v.focus[2];
    const fy = v.focus[1] * (1 - apartK) + ((lowNow + highNow) / 2) * apartK;
    const stackR = Math.max(this.rAssembled, (highNow - lowNow) / 2 + 12);

    // orientation: hero while apart, turning to the section's view
    const idle = 1 - span(p, 0, 0.3);
    this.pointerNow.lerp(this.pointer, 0.05);
    if (this.pointerNow.distanceTo(this.pointer) > 0.0005) moving = true;
    const heroTilt = VIEWS.hero.tilt, heroYaw = VIEWS.hero.yaw;
    const tilt = heroTilt + (v.tilt - heroTilt) * turn;
    const yawSpin = this.viewTarget === VIEWS.spin ? t * 0.25 : 0;
    const yaw = heroYaw + (v.yaw - heroYaw) * turn + yawSpin;
    if (yawSpin) moving = true;
    const drift = _q2.setFromEuler(
      _e.set(Math.sin(t * 0.35) * 0.05 * idle + this.pointerNow.y * 0.05, Math.sin(t * 0.22) * 0.12 * idle + this.pointerNow.x * 0.08, 0),
    );
    this.pivot.quaternion.setFromAxisAngle(X, tilt).multiply(_q.setFromAxisAngle(Y, yaw)).premultiply(drift);
    this.model.position.set(-fx, -fy, -fz);
    this.pivot.position.y = Math.sin(t * 0.6) * 1.2 * idle;

    // camera: fit the stack, then come in by the view's zoom
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    // beside the words (desktop) the device fits in the left half of the screen
    const fitAspect = this.camera.aspect * (this.portrait ? 1 : 1 - 0.5 * this.shiftNow);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * fitAspect);
    const room = this.portrait ? 1.12 : 1.22;
    // a phone shows the whole device above the words: half the zoom
    const zoom = 1 + (v.zoom - 1) * turn * (this.portrait ? 0.5 : 1);
    const dist = ((stackR * room) / Math.sin(Math.min(vFov, hFov) / 2)) / zoom;
    this.camera.position.set(0, 0, dist);
    this.camera.lookAt(0, 0, 0);

    // room for the words: to the right in the hero on a wide screen, the left half in the
    // sections (desktop), the top of the screen in the sections (phone)
    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    const heroRoom = 1 - easeInOut(clamp(asm * 1.5));
    const s = this.shiftNow;
    const offX = this.portrait ? 0 : w * 0.25 * s - w * 0.14 * heroRoom * (1 - s);
    const offY = this.portrait ? h * 0.12 * heroRoom * (1 - s) + h * 0.27 * s : 0;
    if (Math.abs(offX) > 0.5 || Math.abs(offY) > 0.5) this.camera.setViewOffset(w, h, offX, offY, w, h);
    else this.camera.clearViewOffset();

    // looking straight onto the copper, the room and the key light would wash it out
    const onto = span(tilt, 0.6, 1.57);
    this.scene.environmentIntensity = 0.7 - 0.42 * onto;
    this.key.intensity = 2.6 - 1.5 * onto;

    // the status LEDs: the firmware's colour, scaled the way the window shows it
    let lit = false;
    for (const side of ["blue", "red"] as Side[]) {
      const c = this.leds ? this.leds(side, now) : ([0, 0, 0] as Rgb);
      const m = this.ledMats[side], g = this.glowMats[side];
      // the firmware scales every colour to LED_MAX; the eye reads a dim LED brighter than linear
      const f = (x: number) => Math.pow(x / 255, 0.55);
      if (m) m.color.setRGB(0.05 + f(c[0]) * 1.4, 0.05 + f(c[1]) * 1.4, 0.05 + f(c[2]) * 1.4);
      if (g) g.color.setRGB(f(c[0]) * 0.9, f(c[1]) * 0.9, f(c[2]) * 0.9);
      if (c[0] + c[1] + c[2] > 0) lit = true;
    }
    if (lit && this.ledsAnimating?.()) moving = true;

    if (!(moving || idle > 0 || this.dirty)) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
  }
}

customElements.define("h2h-device", H2HDevice);
