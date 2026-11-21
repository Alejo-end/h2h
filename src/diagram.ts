// The routing diagram: H2H's two modules, the link between them, the two computers and
// the two MIDI jacks, drawn like the art on the top plate. Messages run along it as dots,
// and its two LEDs show what the firmware model shows.
import { h2h, type Route, type Rgb, type Side, type Source } from "./h2h";
import FW from "./firmware.json";

const SVG = "http://www.w3.org/2000/svg";
// paths, each drawn from its outer end toward the module
const PATHS = {
  din: "M 22 52 H 92 L 128 100",
  hostBlue: "M 22 158 H 108",
  link: "M 172 140 H 228",
  hostRed: "M 378 158 H 292",
  out: "M 378 52 H 308 L 272 100",
} as const;
type PathId = keyof typeof PATHS;
type Leg = [PathId, boolean]; // the path, and true to run it from the module outward

const rgbCss = (c: Rgb | number[], a = 1) => `rgb(${c[0]} ${c[1]} ${c[2]} / ${a})`;

export class Diagram {
  el: SVGSVGElement;
  private paths = {} as Record<PathId, SVGPathElement>;
  private leds = {} as Record<Side, SVGCircleElement>;
  private modules = {} as Record<Side, SVGGElement>;
  private labels = {} as Record<string, SVGTextElement>;
  private shared!: SVGGElement;
  private running = false;

  constructor(host: HTMLElement, opts: { power?: boolean } = {}) {
    const svg = (this.el = document.createElementNS(SVG, "svg"));
    svg.setAttribute("viewBox", "0 0 400 216");
    svg.setAttribute("class", "diagram");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "H2H: MIDI IN and host blue on the blue module, host red and MIDI OUT on the red module, a link between the two modules");
    svg.innerHTML = `
      <defs>
        <marker id="arrow-${opts.power ? "p" : "r"}" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
        </marker>
      </defs>
      <rect class="case" x="98" y="82" width="204" height="110" rx="12" />
      <text class="tiny" x="200" y="206" text-anchor="middle">h2h</text>`;
    const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = svg) => {
      const e = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      parent.appendChild(e);
      return e;
    };
    for (const id of Object.keys(PATHS) as PathId[]) {
      const p = mk("path", { d: PATHS[id], class: `wire wire-${id}` });
      this.paths[id] = p;
    }
    mk("path", { d: "M 172 152 H 228", class: "wire wire-link2" });
    // the shared supply on "1 cable"
    this.shared = mk("g", { class: "shared" });
    mk("path", { d: "M 160 176 H 240", class: "wire-power" }, this.shared);
    mk("text", { x: 200, y: 172, class: "tiny", "text-anchor": "middle" }, this.shared).textContent = "3v3 + gnd";
    for (const side of ["blue", "red"] as Side[]) {
      const x = side === "blue" ? 108 : 228;
      const g = mk("g", { class: `module module-${side}` });
      mk("rect", { x, y: 100, width: 64, height: 72, rx: 8 }, g);
      mk("text", { x: x + 32, y: 120, class: "tiny", "text-anchor": "middle" }, g).textContent = side;
      this.leds[side] = mk("circle", { cx: x + 32, cy: 146, r: 9, class: "led" }, g);
      this.modules[side] = g;
    }
    const label = (id: string, x: number, y: number, text: string, anchor = "start") => {
      const t = mk("text", { x, y, class: "label", "text-anchor": anchor });
      t.textContent = text;
      this.labels[id] = t;
    };
    label("din", 22, 42, "midi in");
    label("hostBlue", 22, 148, "host blue");
    label("hostRed", 378, 148, "host red", "end");
    label("out", 378, 42, "midi out", "end");
    host.appendChild(svg);
    this.update();
    h2h.addEventListener("change", () => this.update());
  }

  /** Shows which module has power, which computer is plugged in, and the shared supply. */
  update() {
    for (const s of ["blue", "red"] as Side[]) this.modules[s].classList.toggle("off", !h2h.powered(s));
    this.paths.hostBlue.classList.toggle("unplugged", !h2h.plugged.blue);
    this.paths.hostRed.classList.toggle("unplugged", !h2h.plugged.red);
    this.labels.hostBlue.classList.toggle("unplugged", !h2h.plugged.blue);
    this.labels.hostRed.classList.toggle("unplugged", !h2h.plugged.red);
    this.shared.classList.toggle("on", h2h.cables === 1);
    this.paths.out.classList.toggle("quiet", !h2h.powered("red"));
    this.paths.din.classList.toggle("quiet", !h2h.powered("blue"));
    this.wake();
  }

  // the LEDs follow the model while anything changes
  private wake() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      const now = performance.now();
      for (const s of ["blue", "red"] as Side[]) {
        const c = h2h.color(s, now);
        const lit = c[0] + c[1] + c[2] > 0;
        const f = (x: number) => Math.round(255 * Math.pow(x / 255, 0.55));
        this.leds[s].style.fill = lit ? rgbCss([f(c[0]), f(c[1]), f(c[2])]) : "";
        this.leds[s].style.filter = lit ? `drop-shadow(0 0 6px ${rgbCss([f(c[0]), f(c[1]), f(c[2])], 0.8)})` : "";
      }
      if (h2h.animating(now)) requestAnimationFrame(tick);
      else this.running = false;
    };
    requestAnimationFrame(tick);
  }

  /** Runs a message along the diagram. */
  async play(route: Route) {
    this.wake();
    const colour: Rgb = (route.from === "din" ? FW.led.dinIn : FW.led.usbOut) as Rgb;
    const first: Record<Source, Leg> = { blue: ["hostBlue", false], red: ["hostRed", false], din: ["din", false] };
    if (route.lost) {
      await this.dot(first[route.from], colour, 0.55);
      return;
    }
    await this.dot(first[route.from], colour);
    const legs: Promise<void>[] = [];
    const toHost = (s: Side) => (route.hosts.includes(s) ? this.dot([s === "blue" ? "hostBlue" : "hostRed", true], colour).then(() => this.ping(s === "blue" ? "hostBlue" : "hostRed")) : Promise.resolve());
    if (route.from === "blue") {
      if (route.link) legs.push(this.dot(["link", false], colour).then(() => Promise.all([toHost("red"), route.midiOut ? this.dot(["out", true], colour).then(() => this.ping("out")) : null]).then(() => {})));
    } else if (route.from === "red") {
      if (route.midiOut) legs.push(this.dot(["out", true], colour).then(() => this.ping("out")));
      if (route.link) legs.push(this.dot(["link", true], colour).then(() => toHost("blue")));
    } else {
      legs.push(toHost("blue"));
      if (route.link) legs.push(this.dot(["link", false], colour).then(() => Promise.all([toHost("red"), route.midiOut ? this.dot(["out", true], colour).then(() => this.ping("out")) : null]).then(() => {})));
    }
    await Promise.all(legs);
  }

  private ping(id: string) {
    const t = this.labels[id];
    t.classList.remove("ping");
    void t.getBBox();
    t.classList.add("ping");
  }

  // one dot along one path; `part` < 1 stops it on the way and fades it (a lost message)
  private dot([id, outward]: Leg, c: Rgb, part = 1): Promise<void> {
    const path = this.paths[id];
    const len = path.getTotalLength();
    // the link is the 1 Mbaud board trace: it is drawn as fast as it is
    const ms = (id === "link" ? 140 : 380) * part;
    const d = document.createElementNS(SVG, "circle");
    d.setAttribute("r", "4.2");
    d.setAttribute("class", "dot");
    d.style.fill = rgbCss(c);
    d.style.filter = `drop-shadow(0 0 5px ${rgbCss(c, 0.9)})`;
    this.el.appendChild(d);
    // every path is drawn toward a module (the link from blue to red), so outward runs it backwards
    const reverse = outward;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const at = (reverse ? 1 - e * part : e * part) * len;
        const p = path.getPointAtLength(at);
        d.setAttribute("cx", String(p.x));
        d.setAttribute("cy", String(p.y));
        if (part < 1) d.style.opacity = String(1 - k * k);
        if (k < 1) requestAnimationFrame(step);
        else {
          d.remove();
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }
}
