import "@fontsource-variable/figtree";
import "./style.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "./h2h-device"; // registers <h2h-device>
import type { H2HDevice } from "./h2h-device";
import { h2h, type Side, type Source } from "./h2h";
import { Diagram } from "./diagram";
import { mountTrs } from "./trs";
import { mountPanic, type Held } from "./panic";
import { orderHref, ISSUE_URL } from "./config";
import FW from "./firmware.json";

gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ ignoreMobileResize: true });

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const desktop = matchMedia("(min-width: 960px)");
if (reduce) document.documentElement.classList.add("reduce");
const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document) => [...root.querySelectorAll<T>(s)];

// ---- ordering: every Order button opens the order form (src/config.ts) ----
$$<HTMLAnchorElement>("[data-order]").forEach((a) => {
  a.href = orderHref();
  a.target = "_blank";
  a.rel = "noopener";
});
$$<HTMLAnchorElement>("[data-issue]").forEach((a) => {
  a.href = ISSUE_URL;
  a.target = "_blank";
  a.rel = "noopener";
});

// ---- the device ----------------------------------------------------------
const device = $<H2HDevice>("h2h-device");
device.addEventListener("nowebgl", () => document.documentElement.classList.add("no-webgl"));
device.leds = (s, now) => h2h.color(s, now);
device.ledsAnimating = () => h2h.animating();
h2h.addEventListener("change", () => device.poke());
if (import.meta.env.DEV) Object.assign(window, { h2h, device });

// ---- smooth scroll -------------------------------------------------------
if (!reduce) {
  const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, anchors: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

// ---- the stage: apart, together, plugged in ------------------------------
let on = false;
// a demo used before the stage finished plugs H2H in first
const ensureOn = () => plugIn(true);
function plugIn(v: boolean) {
  if (v === on) return;
  on = v;
  if (v) h2h.start();
  else h2h.stop();
}
if (reduce) {
  device.progress = 1;
  plugIn(true);
} else {
  ScrollTrigger.create({
    trigger: "#stage",
    start: "top top",
    end: "bottom bottom",
    onUpdate: (st) => {
      device.progress = st.progress;
      plugIn(st.progress > 0.9);
    },
  });
  const tl = gsap.timeline({ scrollTrigger: { trigger: "#stage", start: "top top", end: "bottom bottom", scrub: true } });
  tl.to(".hero-copy", { autoAlpha: 0, y: -24, duration: 0.07, ease: "power1.in" }, 0.03)
    .fromTo(".note-on", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.8)
    .to(".note-on", { autoAlpha: 0, duration: 0.04 }, 0.96)
    .set({}, {}, 1);
}
// the sections: the device moves aside (desktop) or up (phone)
ScrollTrigger.create({
  trigger: "#features",
  start: "top bottom",
  end: "top 30%",
  onUpdate: (st) => (device.shift = st.progress),
});
// past the sections, it fades for the photos
ScrollTrigger.create({
  trigger: "#photos",
  start: "top 85%",
  end: "top 25%",
  onUpdate: (st) => (device.style.opacity = String(Math.max(0, 1 - st.progress))),
});

// each section turns the device to what it talks about
let current: HTMLElement | null = null;
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      if (el === current) continue;
      current?.removeAttribute("aria-current");
      current = el;
      el.setAttribute("aria-current", "true");
      device.view = el.dataset.view ?? "top";
    }
  },
  { rootMargin: "-40% 0px -50% 0px" },
);
$$(".feature").forEach((el) => io.observe(el));
// above the sections, the hero view
ScrollTrigger.create({ trigger: "#features", start: "top 60%", onLeaveBack: () => ((device.view = "hero"), (current = null)) });

// ---- routing: a keyboard, three sources ----------------------------------
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
let source: Source = "blue";
const route = new Diagram($("[data-diagram=route]"));
new Diagram($("[data-diagram=power]"), {
  mode: "power",
  viewBox: [4.4, 16.4, 56.9, 16.6],
  label: "The lower half of the top plate: host blue and its light on the left, host red and its light on the right, joined across the middle on 1 cable",
});
const keys = $(".keys");
for (let n = 60; n <= 72; n++) {
  const black = NAMES[n % 12].includes("#");
  const b = document.createElement("button");
  b.type = "button";
  b.className = black ? "key black" : "key";
  b.dataset.note = String(n);
  b.setAttribute("aria-label", noteName(n));
  if (!black) b.innerHTML = `<span>${noteName(n)}</span>`;
  keys.appendChild(b);
}
$$<HTMLButtonElement>("[data-source]").forEach((b) =>
  b.addEventListener("click", () => {
    source = b.dataset.source as Source;
    $$("[data-source]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  }),
);
const log = $(".log");
const where = { blue: "host blue", red: "host red", din: "MIDI IN" } as const;
keys.addEventListener("pointerdown", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".key");
  if (!b) return;
  play(Number(b.dataset.note));
});
keys.addEventListener("keydown", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".key");
  if (b && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    play(Number(b.dataset.note));
  }
});
// what each output still holds: the notes the firmware would send a note off for on panic
const held: Held = { blue: new Set(), red: new Set(), out: new Set() };
function play(note: number) {
  ensureOn();
  const r = h2h.send(source, note);
  void route.play(r);
  if (r.lost) {
    log.textContent = `${noteName(note)} from ${where[source]} lost. ${r.lost[0].toUpperCase()}${r.lost.slice(1)}.`;
    return;
  }
  for (const s of r.hosts) held[s].add(note);
  if (r.midiOut) held.out.add(note);
  const to = [...r.hosts.map((s) => `host ${s}`), ...(r.midiOut ? ["MIDI OUT"] : [])];
  log.textContent = to.length ? `${noteName(note)} from ${where[source]} reached ${list(to)}.` : `${noteName(note)} from ${where[source]} reached no one.`;
  if (r.midiOut || r.hosts.length) beep(note);
}
const list = (a: string[]) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

// a soft pluck, so a note is heard as well as seen
let audio: AudioContext | null = null;
function beep(note: number) {
  audio ??= new AudioContext();
  const t = audio.currentTime;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = "triangle";
  o.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + 0.65);
}

// ---- cables: the switch and the two plugs ---------------------------------
const cableStatus = $("#cables .status");
function cablesText() {
  const { blue, red } = h2h.plugged;
  if (h2h.cables === 2) {
    if (blue && red) return "Each side runs from its own computer. Grounds separate.";
    if (!blue && !red) return "No cable, no power.";
    const off: Side = blue ? "red" : "blue";
    return off === "red"
      ? "Red side off. MIDI OUT is silent. Blue stops driving the link after 8 ms and checks it every 2 s."
      : "Blue side off. MIDI IN is not read. Red stops driving the link after 8 ms and checks it every 2 s.";
  }
  if (blue && red) return "One supply for both sides. Use this with a single computer or a charger.";
  if (!blue && !red) return "No cable, no power.";
  const lone: Side = blue ? "red" : "blue";
  return `One cable powers both sides. The ${lone} side breathes: power, no computer.`;
}
const updateCables = () => (cableStatus.textContent = cablesText());
$$<HTMLButtonElement>("[data-cables]").forEach((b) =>
  b.addEventListener("click", () => {
    const n = Number(b.dataset.cables) as 1 | 2;
    ensureOn();
    h2h.setCables(n);
    $$("[data-cables]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    device.setSlider("SW2", n === 2 ? -1 : 1);
    updateCables();
  }),
);
$$<HTMLInputElement>("[data-plug]").forEach((i) =>
  i.addEventListener("change", () => {
    ensureOn();
    h2h.setPlugged(i.dataset.plug as Side, i.checked);
    updateCables();
  }),
);
device.setSlider("SW2", -1);
updateCables();

// ---- TRS type ---------------------------------------------------------------
const setTrsView = mountTrs($(".trs-host"));
setTrsView("a");
$$<HTMLButtonElement>("[data-trs]").forEach((b) =>
  b.addEventListener("click", () => {
    const t = b.dataset.trs as "a" | "b";
    ensureOn();
    h2h.setTrs(t);
    $$("[data-trs]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    device.setSlider("SW3", t === "a" ? -1 : 1);
    setTrsView(t);
  }),
);
device.setSlider("SW3", -1);

// ---- panic ------------------------------------------------------------------
const panicStatus = $("#panic .status");
const panicPlate = new Diagram($("[data-diagram=panic]"), { mode: "panic" });
const readout = mountPanic($(".panic-readout"));
function panic() {
  ensureOn();
  device.press();
  if (!h2h.panic()) {
    panicStatus.textContent = "The red side has no power. Plug in host red, or switch to 1 cable.";
    return;
  }
  // the panic starts on the red module: MIDI OUT always, host red when a computer is
  // there, host blue across the link when the blue module runs
  const to = { out: true, red: h2h.plugged.red, blue: h2h.powered("blue") && h2h.plugged.blue };
  void panicPlate.panic(to);
  readout(to, held);
  held.blue.clear();
  held.red.clear();
  held.out.clear();
  panicStatus.textContent = "Sent. The red light holds white for 400 ms.";
}
panicPlate.onCap = panic;
$(".panic-btn").addEventListener("click", panic);

// ---- the stage facts, from the firmware -------------------------------------
const facts: [string, string][] = [
  ["Separate queues", "Each output has its own queue, so a slow one never holds up the rest. MIDI OUT runs at 31250 baud, about 1000 messages a second. Past that it drops controllers first, then new notes. Never a note off."],
  ["Steady clock", "Clock, start and stop skip the queues."],
  ["Hot plugging", "Every input is repaired first and only whole messages pass. A cable pulled mid message cannot leave a port silent."],
  ["Fast link", `The modules talk over a board trace at ${FW.linkBaud / 1e6} Mbaud. A three byte message takes 30 µs. On a MIDI cable it takes 1 ms.`],
  ["Noise filter", `${FW.linkJunkMax} bad messages in ${FW.linkJunkWindowMs} ms close the link, for example after a broken solder joint. It checks every ${FW.linkPingMs / 1000} s and reopens after ${FW.linkQuietMs / 1000} s of quiet. Nothing reaches a computer meanwhile.`],
  ["Large SysEx", `SysEx up to ${FW.sysexMax} bytes passes in one piece. That covers most patch and bank dumps. Longer messages go in parts.`],
  ["Watchdog", `A module that stalls for ${FW.watchdogMs / 1000} s restarts.`],
  ["Firmware check", "At start each module sends its firmware date to the other. If they differ, both lights blink orange three times."],
];
$("#stage-facts").innerHTML = facts.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join("");
$("#tested").textContent =
  "Mac to norns, 514 of 514 messages exact in both directions, including SysEx of 13 and 203 bytes. TRS to and from norns, 512 messages each way, all received. The firmware runs in a simulator with a fuzzer before it goes on a board.";

// ---- the lights ----------------------------------------------------------------
type Row = { swatch: string; text: string; show?: () => void };
const rgb = (c: number[]) => `rgb(${c.join(" ")})`;
const rows: Row[] = [
  { swatch: `linear-gradient(90deg, rgb(70 110 255) 50%, rgb(255 60 60) 50%)`, text: "Blue or red, steady. A computer is connected." },
  { swatch: "rgb(255 60 60 / 0.5)", text: "Breathing. Power, no computer. A charger, a sleeping laptop, or 1 cable with only the other side plugged.", show: () => h2h.show("breath", "red") },
  { swatch: rgb(FW.led.boot), text: "Orange, brief. Starting up.", show: () => h2h.start() },
  { swatch: rgb(FW.led.handshake), text: "Cyan, twice. The two sides found each other.", show: () => (h2h.show("handshake", "blue"), h2h.show("handshake", "red")) },
  { swatch: rgb(FW.led.usbOut), text: "Yellow flash. A message from this side's computer, going across.", show: () => h2h.show("usbOut", "blue") },
  { swatch: rgb(FW.led.linkIn), text: "Green flash. A message from the other side.", show: () => h2h.show("linkIn", "red") },
  { swatch: rgb(FW.led.dinIn), text: "Magenta flash, blue side. A message from MIDI IN.", show: () => h2h.show("dinIn", "blue") },
  { swatch: rgb(FW.led.panic), text: "White, once or twice, red side. MIDI OUT set to type A or B.", show: () => h2h.show("type", "red") },
  { swatch: rgb(FW.led.panic), text: "White, held, red side. Panic.", show: () => h2h.show("panic", "red") },
  { swatch: rgb(FW.led.mismatch), text: "Orange, three times. The sides run different firmware.", show: () => (h2h.show("mismatch", "blue"), h2h.show("mismatch", "red")) },
  { swatch: "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)", text: "One more. Not listed." },
];
const legend = $("#legend");
for (const r of rows) {
  const li = document.createElement("li");
  const inner = `<span class="sw" style="background:${r.swatch}"></span><span>${r.text}</span>`;
  if (r.show) {
    li.innerHTML = `<button type="button">${inner}</button>`;
    li.querySelector("button")!.addEventListener("click", () => {
      ensureOn();
      r.show!();
    });
  } else li.innerHTML = `<div>${inner}</div>`;
  legend.appendChild(li);
}

desktop.addEventListener("change", () => ScrollTrigger.refresh());
