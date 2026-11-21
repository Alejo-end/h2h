// The plate diagram: the real art of H2H's top plate, built from KiCad's plots of it
// (src/plate.json and public/plate-maze.webp). The maze sits dim underneath; the arrows,
// the rings and the logo are the plate's own copper geometry, drawn crisp on top. A message
// is light running through those traces, and the two LED windows glow in the firmware's
// colours (h2h.color), the way the real ones do.
//
// Coordinates are plate millimetres: the plate's corner is (0, 0), board (-3.2, -3.2) mm.
import { h2h, type Route, type Rgb, type Side } from "./h2h";
import FW from "./firmware.json";
import PLATE from "./plate.json";
import CROP from "./plate-crop.json";

const NS = "http://www.w3.org/2000/svg";
type Pt = [number, number];
type Mode = "route" | "power" | "panic";

const pts = (s: string): Pt[] => {
  const n = s.match(/-?[\d.]+/g)!.map(Number);
  const out: Pt[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
};
// the plate's 0.6 mm traces, in the order KiCad plots them
const [T_DIN, , T_BLUE_DIAG, T_OUT, T_RED_DIAG] = PLATE.traces.map(pts);
const TRACE_NAMES = ["din", "blue", "blue-diag", "out", "red-diag", "red"];
const HUB: Pt = [32.8499, 22.45];
const HUB_R = 4.9; // the thin ring through the four vias
const LED: Record<Side, Pt> = { blue: [22.81, 29.2], red: [42.89, 29.2] };
const VIA = { tl: T_DIN[T_DIN.length - 1], bl: T_BLUE_DIAG[T_BLUE_DIAG.length - 1], tr: T_OUT[0], br: T_RED_DIAG[0] };
const angle = (p: Pt) => Math.atan2(p[1] - HUB[1], p[0] - HUB[0]);
const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
// an arc on the hub ring from one via to another, the way that passes `through` degrees
function arc(a: Pt, b: Pt, through: number): Pt[] {
  const a0 = angle(a);
  const t = (through * Math.PI) / 180;
  const ccw = norm(angle(b) - a0); // growing angle: clockwise on screen
  const a1 = norm(t - a0) < ccw ? a0 + ccw : a0 - norm(a0 - angle(b));
  const n = 24, out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const u = a0 + ((a1 - a0) * i) / n;
    out.push([HUB[0] + HUB_R * Math.cos(u), HUB[1] + HUB_R * Math.sin(u)]);
  }
  return out;
}
const rev = (p: Pt[]) => p.slice().reverse();
// each leg in the direction light runs it
const LEGS = {
  dinIn: [[5.45, 11.2] as Pt, ...T_DIN],
  blueIn: [[5.45, 29.2], [19.81, 29.2]] as Pt[],
  blueOut: [[19.81, 29.2], [5.45, 29.2]] as Pt[],
  redIn: [[60.25, 29.2], [45.89, 29.2]] as Pt[],
  redOut: [[45.89, 29.2], [60.25, 29.2]] as Pt[],
  blueDiagIn: T_BLUE_DIAG, // from the blue LED ring to the hub
  blueDiagOut: rev(T_BLUE_DIAG),
  redDiagIn: rev(T_RED_DIAG), // from the red LED ring to the hub
  redDiagOut: T_RED_DIAG,
  out: [...T_OUT, [60.25, 11.2] as Pt],
  hubBlBr: arc(VIA.bl, VIA.br, 90),
  hubBrBl: arc(VIA.br, VIA.bl, 90),
  hubBrTr: arc(VIA.br, VIA.tr, 0),
  hubTlBl: arc(VIA.tl, VIA.bl, 180),
};
type LegId = keyof typeof LEGS;
// the arrowheads, by where they sit
const HEAD_AT: Record<string, Pt> = { din: [6.5, 11.2], blueOuter: [6.5, 29.2], blueInner: [17.5, 29.2], redInner: [48.2, 29.2], redOuter: [59.2, 29.2], out: [59.2, 11.2] };

const path = (p: Pt[]) => "M" + p.map((q) => `${q[0].toFixed(3)} ${q[1].toFixed(3)}`).join("L");
const css = (c: Rgb | number[], a = 1) => `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0} / ${a})`;
// the eye reads a dim LED brighter than linear; the same curve as the 3D device
const lift = (c: Rgb): Rgb => c.map((x) => Math.round(255 * Math.pow(x / 255, 0.55))) as Rgb;
const mix = (a: Rgb | number[], b: Rgb | number[], k: number): Rgb => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k) as Rgb;
const WHITE: Rgb = [255, 255, 255];
const COPPER: Rgb = [209, 145, 107];
const WARM: Rgb = [255, 196, 150]; // copper, hot: power on a trace
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

let uid = 0;

export class Diagram {
  el: SVGSVGElement;
  onCap: (() => void) | null = null;
  private id = `pd${uid++}`;
  private mode: Mode;
  private led = {} as Record<Side, { win: SVGCircleElement; glow: SVGCircleElement; stop: SVGStopElement }>;
  private heads = {} as Record<string, SVGPathElement>;
  private labels = {} as Record<string, SVGTextElement>;
  private lights!: SVGGElement;
  private running = false;
  private seen = false;
  private was = { blue: true, red: true };
  private flowTimer = 0;

  constructor(host: HTMLElement, opts: { mode?: Mode; viewBox?: [number, number, number, number]; label?: string } = {}) {
    this.mode = opts.mode ?? "route";
    const id = this.id;
    const vb = opts.viewBox ?? [CROP.x, CROP.y + 0.6, CROP.w, CROP.h - 1.2];
    const svg = (this.el = document.createElementNS(NS, "svg"));
    svg.setAttribute("viewBox", vb.join(" "));
    svg.setAttribute("class", `plate plate-${this.mode}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", opts.label ?? "The top plate of H2H: MIDI IN and host blue on the left, MIDI OUT and host red on the right, the panic button in the middle");
    const big = `x="${CROP.x - 4}" y="${CROP.y - 4}" width="${CROP.w + 8}" height="${CROP.h + 8}" filterUnits="userSpaceOnUse"`;
    svg.innerHTML = `
      <defs>
        <filter id="${id}-soft" ${big}><feGaussianBlur stdDeviation="0.45" /></filter>
        <filter id="${id}-wide" ${big}><feGaussianBlur stdDeviation="1.1" /></filter>
        <radialGradient id="${id}-fade" cx="50%" cy="50%" r="64%">
          <stop offset="0.5" stop-color="#fff" /><stop offset="1" stop-color="#000" />
        </radialGradient>
        <mask id="${id}-mask" maskUnits="userSpaceOnUse" x="${CROP.x}" y="${CROP.y}" width="${CROP.w}" height="${CROP.h}">
          <rect x="${CROP.x}" y="${CROP.y}" width="${CROP.w}" height="${CROP.h}" fill="url(#${id}-fade)" />
        </mask>
        ${(["blue", "red"] as Side[]).map((s) => `<radialGradient id="${id}-led-${s}"><stop offset="0" stop-color="#000" /><stop offset="1" stop-color="#000" stop-opacity="0" /></radialGradient>`).join("")}
        <radialGradient id="${id}-cap" cx="42%" cy="36%" r="72%"><stop offset="0" stop-color="#303035" /><stop offset="0.65" stop-color="#111114" /><stop offset="1" stop-color="#050506" /></radialGradient>
      </defs>
      <image class="maze" href="${import.meta.env.BASE_URL}plate-maze.webp" x="${CROP.x}" y="${CROP.y}" width="${CROP.w}" height="${CROP.h}" mask="url(#${id}-mask)" preserveAspectRatio="none" />
      <g class="copper">
        ${PLATE.traces.map((t, i) => `<path class="trace t-${TRACE_NAMES[i]}" d="${t}" />`).join("")}
        <circle class="ring" cx="${HUB[0]}" cy="${HUB[1]}" r="3.9" stroke-width="0.3" />
        <circle class="ring hub" cx="${HUB[0]}" cy="${HUB[1]}" r="${HUB_R}" stroke-width="0.15" />
        ${PLATE.circles.filter((c) => c.r < 1).map((c) => `<circle class="via" cx="${c.cx}" cy="${c.cy}" r="${c.r}" />`).join("")}
        ${(["blue", "red"] as Side[]).map((s) => `<circle class="ring led-ring" cx="${LED[s][0]}" cy="${LED[s][1]}" r="3" stroke-width="0.3" />`).join("")}
        <g class="logo">${PLATE.logo}</g>
      </g>
      <g class="heads"></g>`;
    const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      parent.appendChild(e);
      return e;
    };
    const copper = svg.querySelector("g.copper")!;
    if (this.mode === "power") {
      // the shared supply: on 1 cable the lower half of the hub ring joins the two sides
      mk("path", { d: path(LEGS.hubBlBr), class: "shared" }, copper);
    }
    // the arrowheads, each its own element so it can light
    const heads = svg.querySelector("g.heads")!;
    for (const h of PLATE.heads) {
      const name = Object.entries(HEAD_AT).find(([, p]) => Math.hypot(p[0] - h.cx, p[1] - h.cy) < 1.5)?.[0] ?? `h${h.cx}`;
      this.heads[name] = mk("path", { d: h.d, class: `head head-${name}` }, heads);
    }
    // the LED windows: a glow over the copper, the window itself on top
    for (const s of ["blue", "red"] as Side[]) {
      const [cx, cy] = LED[s];
      const glow = mk("circle", { cx, cy, r: 6.5, class: "led-glow", fill: `url(#${id}-led-${s})` }, svg);
      const win = mk("circle", { cx, cy, r: 1.8, class: "led-win" }, svg);
      this.led[s] = { win, glow, stop: svg.querySelector<SVGStopElement>(`#${id}-led-${s} stop`)! };
    }
    // the panic cap, pressable, in the panic demo
    if (this.mode === "panic") {
      const cap = mk("g", { class: "cap", role: "button", tabindex: 0, "aria-label": "Press panic" }, svg);
      mk("circle", { cx: HUB[0], cy: HUB[1], r: 3.5, class: "cap-face", fill: `url(#${id}-cap)` }, cap);
      mk("circle", { cx: HUB[0], cy: HUB[1], r: 3.5, class: "cap-edge" }, cap);
      const press = () => {
        cap.animate([{ transform: "scale(0.93)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
        this.onCap?.();
      };
      cap.addEventListener("click", press);
      cap.addEventListener("keydown", (e) => {
        const k = (e as KeyboardEvent).key;
        if (k === "Enter" || k === " ") {
          e.preventDefault();
          press();
        }
      });
    }
    this.lights = mk("g", { class: "lights" }, svg);
    // the print: the plate's own words, set in the page's type
    const print = mk("g", { class: "print" }, svg);
    const label = (key: string, x: number, y: number, text: string, anchor = "start") => {
      const t = mk("text", { x, y, "text-anchor": anchor, class: `l-${key}` }, print);
      t.textContent = text;
      this.labels[key] = t;
    };
    if (this.mode !== "power") {
      label("din", 6.7, 9.52, "midi in");
      label("out", 59.0, 9.52, "midi out", "end");
    }
    label("blue", 6.7, 27.52, "host blue");
    label("red", 59.0, 27.52, "host red", "end");
    if (this.mode !== "power") label("panic", HUB[0], 29.2, "panic", "middle");
    host.appendChild(svg);
    new IntersectionObserver(([e]) => {
      this.seen = e.isIntersecting;
      this.flow();
    }).observe(svg);
    this.update();
    h2h.addEventListener("change", () => this.update());
  }

  /** Shows which module has power and which computer is plugged in. */
  update() {
    const c = this.el.classList;
    c.toggle("blue-off", !h2h.powered("blue"));
    c.toggle("red-off", !h2h.powered("red"));
    c.toggle("blue-unplugged", !h2h.plugged.blue);
    c.toggle("red-unplugged", !h2h.plugged.red);
    c.toggle("one-cable", h2h.cables === 1);
    if (this.mode === "power") {
      // a cable going in brings power along its trace
      for (const s of ["blue", "red"] as Side[]) {
        if (h2h.plugged[s] && !this.was[s]) void this.run(s === "blue" ? "blueIn" : "redIn", WARM, { speed: 0.05 });
        this.was[s] = h2h.plugged[s];
      }
      this.flow();
    }
    this.wake();
  }

  // on 1 cable, power runs across the hub from the side with a computer
  private flow() {
    if (this.mode !== "power") return;
    const want = this.seen && h2h.cables === 1 && (h2h.plugged.blue || h2h.plugged.red) && !reduce;
    if (want && !this.flowTimer) {
      let k = 0;
      const tick = () => {
        const both = h2h.plugged.blue && h2h.plugged.red;
        const from: Side = both ? (k++ % 2 ? "red" : "blue") : h2h.plugged.blue ? "blue" : "red";
        if (from === "blue") void this.chain(["blueDiagIn", "hubBlBr", "redDiagOut"], WARM, 0.03);
        else void this.chain(["redDiagIn", "hubBrBl", "blueDiagOut"], WARM, 0.03);
      };
      tick();
      this.flowTimer = window.setInterval(tick, 1400);
    } else if (!want && this.flowTimer) {
      clearInterval(this.flowTimer);
      this.flowTimer = 0;
    }
  }

  // the LEDs follow the model while anything changes
  private wake() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      const now = performance.now();
      for (const s of ["blue", "red"] as Side[]) this.paintLed(s, h2h.color(s, now));
      if (h2h.animating(now)) requestAnimationFrame(tick);
      else this.running = false;
    };
    requestAnimationFrame(tick);
  }
  private paintLed(s: Side, raw: Rgb) {
    const { win, glow, stop } = this.led[s];
    const c = lift(raw);
    const k = Math.max(c[0], c[1], c[2]) / 255;
    win.style.fill = k > 0.02 ? css(mix(c, WHITE, 0.4)) : "";
    stop.setAttribute("stop-color", css(c));
    glow.style.opacity = String(0.9 * k);
  }

  /** Runs a message through the plate, the way the firmware routes it. */
  async play(route: Route) {
    this.wake();
    const src: Rgb = (route.from === "din" ? FW.led.dinIn : FW.led.usbOut) as Rgb;
    const far = FW.led.linkIn as Rgb; // past the link, the other module flashes green
    const toRed = (c: Rgb) =>
      this.chain(["redDiagOut"], c).then(() => {
        this.bloom("red", c);
        return route.hosts.includes("red") ? this.chain(["redOut"], c).then(() => this.arrive("redOuter", "red", c)) : undefined;
      });
    const toBlue = (c: Rgb, legs: LegId[]) =>
      this.chain(legs, c).then(() => {
        this.bloom("blue", c);
        return route.hosts.includes("blue") ? this.chain(["blueOut"], c).then(() => this.arrive("blueOuter", "blue", c)) : undefined;
      });
    const toOut = (c: Rgb) => (route.midiOut ? this.chain(["hubBrTr", "out"], c).then(() => this.arrive("out", "out", c)) : undefined);
    if (route.from === "blue") {
      this.light("blueOuter", src);
      if (route.lost) return this.run("blueIn", src, { part: 0.55 });
      await this.run("blueIn", src);
      this.bloom("blue", src);
      if (!route.link) return;
      await this.chain(["blueDiagIn", "hubBlBr"], src);
      await Promise.all([toRed(far), toOut(far)]);
    } else if (route.from === "red") {
      this.light("redOuter", src);
      if (route.lost) return this.run("redIn", src, { part: 0.55 });
      await this.run("redIn", src);
      this.bloom("red", src);
      await this.chain(["redDiagIn"], src);
      await Promise.all([toOut(src), route.link ? toBlue(far, ["hubBrBl", "blueDiagOut"]) : undefined]);
    } else {
      this.light("din", src);
      if (route.lost) return this.run("dinIn", src, { part: 0.55 });
      await this.chain(["dinIn", "hubTlBl"], src);
      await Promise.all([
        toBlue(src, ["blueDiagOut"]),
        route.link ? this.chain(["hubBlBr"], src).then(() => Promise.all([toRed(far), toOut(far)])) : undefined,
      ]);
    }
  }

  /** The panic burst: from the cap to every output that is there, in quick waves. */
  async panic(to: { blue: boolean; red: boolean; out: boolean }, waves = 5) {
    this.wake();
    const c = FW.led.panic as Rgb;
    this.el.classList.remove("ring-flash");
    void this.el.getBoundingClientRect();
    this.el.classList.add("ring-flash");
    const one = () =>
      Promise.all([
        to.out ? this.chain(["out"], c, 0.09).then(() => this.light("out", c)) : undefined,
        to.red ? this.chain(["redDiagOut", "redOut"], c, 0.09).then(() => this.light("redOuter", c)) : undefined,
        to.blue ? this.chain(["hubBrBl", "blueDiagOut", "blueOut"], c, 0.09).then(() => this.light("blueOuter", c)) : undefined,
      ]);
    const all: Promise<unknown>[] = [];
    for (let i = 0; i < waves; i++) {
      all.push(one());
      await wait(90);
    }
    await Promise.all(all);
  }

  private arrive(head: string, label: string, c: Rgb) {
    this.light(head, c);
    this.labels[label]?.animate([{ fill: css(mix(c, WHITE, 0.55)) }, { fill: "" }], { duration: 900, easing: "ease-out" });
  }

  // an arrowhead lights and cools
  private light(name: string, c: Rgb) {
    const h = this.heads[name];
    if (!h) return;
    const glow = h.cloneNode() as SVGPathElement;
    glow.setAttribute("class", "head-lit");
    glow.style.fill = css(c);
    glow.style.filter = `url(#${this.id}-wide)`;
    const core = h.cloneNode() as SVGPathElement;
    core.setAttribute("class", "head-lit");
    core.style.fill = css(mix(c, WHITE, 0.55));
    this.lights.append(glow, core);
    const a = { duration: 1000, easing: "cubic-bezier(.2,.7,.3,1)" };
    glow.animate([{ opacity: 1 }, { opacity: 0 }], a).onfinish = () => glow.remove();
    core.animate([{ opacity: 1 }, { opacity: 0 }], a).onfinish = () => core.remove();
  }

  // light arriving in an LED window spills over its copper ring
  private bloom(s: Side, c: Rgb) {
    const [cx, cy] = LED[s];
    const ring = document.createElementNS(NS, "circle");
    ring.setAttribute("cx", String(cx));
    ring.setAttribute("cy", String(cy));
    ring.setAttribute("r", "3");
    ring.setAttribute("class", "bloom");
    ring.style.stroke = css(mix(c, WHITE, 0.35));
    ring.style.filter = `url(#${this.id}-soft)`;
    this.lights.appendChild(ring);
    ring.animate([{ opacity: 1, strokeWidth: 1 }, { opacity: 0, strokeWidth: 0.3 }], { duration: 800, easing: "ease-out" }).onfinish = () => ring.remove();
  }

  // several legs one after the other, as one run of light
  private async chain(ids: LegId[], c: Rgb, speed?: number) {
    for (const id of ids) await this.run(id, c, { speed });
  }

  /** One run of light along one leg: a hot head, a fading tail, and the copper behind it
   * glowing for a moment. `part` < 1 stops it on the way (a lost message). */
  private run(id: LegId, c: Rgb, o: { part?: number; speed?: number } = {}): Promise<void> {
    const part = o.part ?? 1;
    const p = path(LEGS[id]);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "run");
    const seg = (stroke: string, w: number, filter?: string) => {
      const e = document.createElementNS(NS, "path");
      e.setAttribute("d", p);
      e.style.stroke = stroke;
      e.style.strokeWidth = String(w);
      if (filter) e.style.filter = `url(#${this.id}-${filter})`;
      g.appendChild(e);
      return e;
    };
    const trail = seg(css(mix(c, COPPER, 0.35), 0.85), 0.6);
    const halo = seg(css(c, 0.75), 1.7, "wide");
    const tail = seg(css(c, 0.5), 0.6);
    const body = seg(css(mix(c, WHITE, 0.25)), 0.6);
    const core = seg(css(mix(c, WHITE, 0.8)), 0.24);
    this.lights.appendChild(g);
    const len = trail.getTotalLength();
    const segs: [SVGPathElement, number][] = [[halo, 4.5], [tail, 8], [body, 2.8], [core, 1.2]];
    for (const [e, s] of segs) e.style.strokeDasharray = `${s} ${len + s + 2}`;
    trail.style.strokeDasharray = `${len} ${len + 2}`;
    // millimetres per millisecond; the hub stands for the 1 Mbaud link between the modules
    const speed = o.speed ?? (id.startsWith("hub") ? 0.14 : 0.075);
    const ms = reduce ? 1 : Math.max(120, (len * part) / speed);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        const head = (1 - Math.pow(1 - k, 1.5)) * part * len; // quick off the mark, settles in
        for (const [el, s] of segs) el.style.strokeDashoffset = String(s - head);
        trail.style.strokeDashoffset = String(len - head);
        if (part < 1) g.style.opacity = String(1 - k * k);
        if (k < 1) requestAnimationFrame(step);
        else {
          for (const [el] of segs) el.remove();
          trail.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: "ease-out" }).onfinish = () => g.remove();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }
}
