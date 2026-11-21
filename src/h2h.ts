// A small model of H2H's firmware, for the page: which module has power, where a message
// goes, and what each status LED shows. The colours, times and rules come from the
// firmware source (src/firmware.json is read from it at build time).
//
// Two modules: blue (M2, host 2, reads MIDI IN) and red (M1, host 1, drives MIDI OUT and
// has the panic button and the TRS A/B switch).
import FW from "./firmware.json";

export type Side = "blue" | "red";
export type Source = "blue" | "red" | "din";
export type Rgb = [number, number, number];
export type Route = { from: Source; note: number; hosts: Side[]; midiOut: boolean; link: boolean; lost?: string };

const SIDES: Side[] = ["blue", "red"];
const BOOT_MS = 350; // the boot colour, while the module starts its USB and its link
const SEEN_FLASH_MS = 110; // a 30 ms flash is two frames on a screen: the page holds it a little longer

type Anim = { kind: "handshake" | "party" | "type" | "mismatch" | "breath"; start: number } | null;

// the firmware's hue(): h in 0..1535, full brightness
function hue(h: number): Rgb {
  const x = h & 255;
  switch (h >> 8) {
    case 0: return [255, x, 0];
    case 1: return [255 - x, 255, 0];
    case 2: return [0, 255, x];
    case 3: return [0, 255 - x, 255];
    case 4: return [x, 0, 255];
    default: return [255, 0, 255 - x];
  }
}

export class H2H extends EventTarget {
  cables: 1 | 2 = 2;
  plugged: Record<Side, boolean> = { blue: true, red: true };
  trs: "a" | "b" = "a";
  private bootAt: Record<Side, number> = { blue: -1, red: -1 };
  private flashes: Record<Side, { c: Rgb; until: number }> = { blue: { c: [0, 0, 0], until: 0 }, red: { c: [0, 0, 0], until: 0 } };
  private anims: Record<Side, Anim> = { blue: null, red: null };
  private presses: number[] = [];
  private eggPos = 0;
  private timers: number[] = [];

  /** The modules start when the page says the cables are in. */
  start(now = performance.now()) {
    this.bootAt = { blue: -1, red: -1 };
    this.power(now);
  }
  stop() {
    this.bootAt = { blue: -1, red: -1 };
    this.anims = { blue: null, red: null };
    this.changed();
  }

  /** On "1 cable" both modules share one 3V3, so either USB port runs both. */
  powered(s: Side) {
    return this.cables === 1 ? this.plugged.blue || this.plugged.red : this.plugged[s];
  }
  private running(s: Side, now: number) {
    return this.bootAt[s] >= 0 && now - this.bootAt[s] >= BOOT_MS;
  }

  setCables(n: 1 | 2) {
    if (n === this.cables) return;
    this.cables = n;
    this.power(performance.now());
  }
  setPlugged(s: Side, on: boolean) {
    if (this.plugged[s] === on) return;
    this.plugged[s] = on;
    this.power(performance.now());
  }
  setTrs(t: "a" | "b") {
    if (t === this.trs) return;
    this.trs = t;
    // the firmware reads the switch live and shows the new type: white once for A, twice for B
    if (this.powered("red") && this.bootAt.red >= 0) this.anims.red = { kind: "type", start: performance.now() };
    this.changed();
  }

  private power(now: number) {
    const booted: Side[] = [];
    for (const s of SIDES) {
      if (this.powered(s) && this.bootAt[s] < 0) {
        this.bootAt[s] = now;
        this.anims[s] = null;
        booted.push(s);
      } else if (!this.powered(s)) {
        this.bootAt[s] = -1;
        this.anims[s] = null;
      }
    }
    for (const s of booted) {
      // red shows its TRS type as it starts; then each module says hello, and if the other one
      // runs, both blink cyan twice
      if (s === "red") this.later(BOOT_MS, () => this.bootAt.red >= 0 && (this.anims.red = { kind: "type", start: performance.now() }));
      const helloAt = BOOT_MS + (s === "red" ? 300 * (this.trs === "a" ? 1 : 2) + 50 : 0);
      this.later(helloAt, () => {
        const other: Side = s === "blue" ? "red" : "blue";
        if (this.bootAt[s] < 0 || !this.running(other, performance.now())) return;
        const t = performance.now();
        this.anims[s] = { kind: "handshake", start: t };
        this.anims[other] = { kind: "handshake", start: t };
      });
    }
    this.changed();
  }

  private later(ms: number, f: () => void) {
    this.timers.push(window.setTimeout(() => { f(); this.changed(); }, ms));
  }
  private changed() {
    this.dispatchEvent(new Event("change"));
  }
  private flash(s: Side, c: Rgb, ms: number) {
    this.flashes[s] = { c, until: performance.now() + Math.max(ms, SEEN_FLASH_MS) };
  }

  /** A note on from a computer or from MIDI IN. Returns where it went. */
  send(from: Source, note: number): Route {
    const now = performance.now();
    const route: Route = { from, note, hosts: [], midiOut: false, link: false };
    const blue = this.running("blue", now), red = this.running("red", now);
    if (from === "blue") {
      if (!this.plugged.blue || !blue) return { ...route, lost: "host blue has no H2H to talk to" };
      this.flash("blue", FW.led.usbOut as Rgb, FW.led.flashMs);
      if (red) {
        route.link = true;
        this.flash("red", FW.led.linkIn as Rgb, FW.led.flashMs);
        if (this.plugged.red) route.hosts.push("red");
        route.midiOut = true;
      }
    } else if (from === "red") {
      if (!this.plugged.red || !red) return { ...route, lost: "host red has no H2H to talk to" };
      this.flash("red", FW.led.usbOut as Rgb, FW.led.flashMs);
      route.midiOut = true;
      if (blue) {
        route.link = true;
        this.flash("blue", FW.led.linkIn as Rgb, FW.led.flashMs);
        if (this.plugged.blue) route.hosts.push("blue");
      }
    } else {
      // MIDI IN arrives on the blue module
      if (!blue) return { ...route, lost: "the blue side has no power, so nothing reads MIDI IN" };
      this.flash("blue", FW.led.dinIn as Rgb, FW.led.flashMs);
      if (this.plugged.blue) route.hosts.push("blue");
      if (FW.midiInToBothHosts && red) {
        route.link = true;
        this.flash("red", FW.led.linkIn as Rgb, FW.led.flashMs);
        if (this.plugged.red) route.hosts.push("red");
        route.midiOut = true;
      }
    }
    this.noteEgg(note);
    this.changed();
    return route;
  }

  private noteEgg(note: number) {
    const secret = FW.egg.notes;
    this.eggPos = note === secret[this.eggPos] ? this.eggPos + 1 : note === secret[0] ? 1 : 0;
    if (this.eggPos === secret.length) {
      this.eggPos = 0;
      this.party();
    }
  }
  private party() {
    const t = performance.now();
    for (const s of SIDES) if (this.running(s, t)) this.anims[s] = { kind: "party", start: t };
  }

  /** The panic button, on the red module. Returns false when the red module has no power. */
  panic(): boolean {
    const now = performance.now();
    if (!this.running("red", now)) return false;
    this.flash("red", FW.led.panic as Rgb, FW.led.panicFlashMs);
    this.presses.push(now);
    this.presses = this.presses.slice(-FW.egg.presses);
    if (this.presses.length === FW.egg.presses && now - this.presses[0] < FW.egg.pressWindowMs) {
      this.presses = [];
      this.party();
    }
    this.changed();
    return true;
  }

  /** Play one state of the light by name, for the legend. */
  show(kind: "handshake" | "type" | "mismatch" | "breath" | "usbOut" | "linkIn" | "dinIn" | "panic", side: Side) {
    const now = performance.now();
    if (!this.running(side, now)) return;
    if (kind === "usbOut" || kind === "linkIn" || kind === "dinIn") this.flash(side, FW.led[kind] as Rgb, 400);
    else if (kind === "panic") this.flash(side, FW.led.panic as Rgb, FW.led.panicFlashMs);
    else this.anims[side] = { kind, start: now };
    this.changed();
  }

  /** The LED's colour now, 0..255 before the firmware's LED_MAX scaling. */
  color(s: Side, now = performance.now()): Rgb {
    if (this.bootAt[s] < 0) return [0, 0, 0];
    if (now - this.bootAt[s] < BOOT_MS) return FW.led.boot as Rgb;
    const a = this.anims[s];
    if (a) {
      const t = now - a.start;
      if (a.kind === "handshake" && t <= FW.led.handshakeMs) return Math.floor(t / 150) % 2 === 0 ? (FW.led.handshake as Rgb) : [0, 0, 0];
      if (a.kind === "party" && t <= FW.led.partyMs) return hue(Math.floor(t * 3) % 1536);
      if (a.kind === "type" && t <= 300 * (this.trs === "a" ? 1 : 2)) return Math.floor(t / 150) % 2 === 0 ? (FW.led.panic as Rgb) : [0, 0, 0];
      if (a.kind === "mismatch" && t <= FW.led.mismatchMs) return Math.floor(t / 200) % 2 === 0 ? (FW.led.mismatch as Rgb) : [0, 0, 0];
      if (a.kind === "breath" && t <= FW.led.breathMs * 2) return this.idle(s, now, true);
      this.anims[s] = null;
    }
    const f = this.flashes[s];
    if (now < f.until) return f.c;
    return this.idle(s, now);
  }

  // red for host 1, blue for host 2: steady with a computer, breathing without one
  private idle(s: Side, now: number, breathe = !this.plugged[s]): Rgb {
    const v = FW.led.idle;
    const c: Rgb = s === "red" ? [v, 0, 0] : [0, 0, v];
    if (!breathe) return c;
    const half = FW.led.breathMs / 2, t = now % FW.led.breathMs;
    const k = t < half ? t : FW.led.breathMs - t;
    const b = 8 + (247 * k * k) / (half * half);
    return [(c[0] * b) / 255, (c[1] * b) / 255, (c[2] * b) / 255];
  }

  /** True while any light changes on its own (breathing, a blink, a flash). */
  animating(now = performance.now()) {
    return SIDES.some(
      (s) =>
        this.bootAt[s] >= 0 &&
        (now - this.bootAt[s] < BOOT_MS + 50 || this.anims[s] !== null || now < this.flashes[s].until + 50 || !this.plugged[s]),
    );
  }
}

export const h2h = new H2H();
