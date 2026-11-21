// The TRS demo: a 3.5 mm plug drawn to scale, with a callout under each contact that says
// what the contact carries on MIDI OUT for the chosen type.
//
// Type A: ring = +V source (DIN pin 4), tip = data (DIN pin 5). Type B swaps tip and ring.
// The sleeve is ground (DIN pin 2) on both.
const NS = "http://www.w3.org/2000/svg";

// The plug in mm, from where the metal leaves the body: sleeve 6.6, insulator 1.0, ring 2.5,
// insulator 1.0, then the tip: a neck the jack's spring sits in, the full 3.5 mm shoulder
// and the cone. 14.9 mm of metal, 3.5 mm across. The body is about 5 mm across.
const W = 320, H = 96;
const S = 11.4; // units per mm
const Y = 40; // the axis
const R = 1.75 * S;
const X0 = 118; // where the metal starts
const at = (mm: number) => X0 + mm * S;
const SLEEVE: [number, number] = [at(0), at(6.6)];
const INS1: [number, number] = [at(6.6), at(7.6)];
const RING: [number, number] = [at(7.6), at(10.1)];
const INS2: [number, number] = [at(10.1), at(11.1)];
const TIP = (() => {
  const a = at(11.1), neck = at(12.0), sh0 = at(12.45), sh1 = at(13.25), cone = at(14.45), end = at(14.9);
  const rn = 1.3 * S, rc = 0.45 * S;
  return `M${a} ${Y - rn}H${neck}L${sh0} ${Y - R}H${sh1}L${cone} ${Y - rc}Q${end} ${Y} ${cone} ${Y + rc}L${sh1} ${Y + R}H${sh0}L${neck} ${Y + rn}H${a}Z`;
})();
const band = ([a, b]: [number, number], r = R) => `M${a} ${Y - r}H${b}V${Y + r}H${a}Z`;
// the moulded body: a slim barrel that steps down to the metal, after the strain relief
const BODY = `M18 ${Y - 13}H40Q46 ${Y - 13} 50 ${Y - 30}H${X0 - 8}Q${X0 - 2} ${Y - 30} ${X0 - 2} ${Y - 24}V${Y + 24}Q${X0 - 2} ${Y + 30} ${X0 - 8} ${Y + 30}H50Q46 ${Y + 13} 40 ${Y + 13}H18Z`;
const COLLAR = band([X0 - 3, X0 + 0.5], R + 3);

const PARTS = [
  { id: "sleeve", x: at(3.3) },
  { id: "ring", x: at(8.85) },
  { id: "tip", x: at(13.3) },
] as const;
const ROLE = {
  gnd: { name: "ground", pin: "DIN pin 2" },
  v: { name: "+V source", pin: "DIN pin 4" },
  data: { name: "data", pin: "DIN pin 5" },
};

export function mountTrs(host: HTMLElement): (t: "a" | "b") => void {
  const fig = document.createElement("figure");
  fig.className = "trs";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "A 3.5 mm TRS plug: sleeve, ring and tip, with what each carries on MIDI OUT");
  svg.innerHTML = `
    <defs>
      <linearGradient id="trs-steel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5d5a55" /><stop offset="0.16" stop-color="#d9d5cd" /><stop offset="0.3" stop-color="#fbf9f4" />
        <stop offset="0.46" stop-color="#b3aea5" /><stop offset="0.72" stop-color="#4d4a46" /><stop offset="0.9" stop-color="#7c7871" /><stop offset="1" stop-color="#3b3936" />
      </linearGradient>
      <linearGradient id="trs-gold" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6e4630" /><stop offset="0.16" stop-color="#e2ad8c" /><stop offset="0.3" stop-color="#ffe2cc" />
        <stop offset="0.46" stop-color="#d1916b" /><stop offset="0.72" stop-color="#5e3a27" /><stop offset="0.9" stop-color="#93603f" /><stop offset="1" stop-color="#3f271a" />
      </linearGradient>
      <linearGradient id="trs-mould" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1a1a1d" /><stop offset="0.18" stop-color="#3b3b40" /><stop offset="0.34" stop-color="#2a2a2e" />
        <stop offset="0.8" stop-color="#0d0d0f" /><stop offset="1" stop-color="#18181b" />
      </linearGradient>
      <linearGradient id="trs-fade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0" /><stop offset="0.14" stop-color="#fff" stop-opacity="1" />
      </linearGradient>
      <mask id="trs-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#trs-fade)" /></mask>
      <filter id="trs-shadow" x="-10%" y="-200%" width="120%" height="500%"><feGaussianBlur stdDeviation="3" /></filter>
    </defs>
    <ellipse cx="${(40 + at(14.9)) / 2}" cy="${Y + 36}" rx="${(at(14.9) - 40) / 2}" ry="2.5" fill="#000" opacity="0.6" filter="url(#trs-shadow)" />
    <g mask="url(#trs-mask)">
      <path d="M0 ${Y - 8}H22V${Y + 8}H0Z" fill="url(#trs-mould)" />
      <path d="${BODY}" fill="url(#trs-mould)" />
      <path d="M54 ${Y - 26.5}H${X0 - 9}" class="hl" />
    </g>
    <path d="${COLLAR}" fill="url(#trs-steel)" />
    <path class="contact" data-part="sleeve" d="${band(SLEEVE)}" />
    <path class="ins" d="${band(INS1)}" />
    <path class="contact" data-part="ring" d="${band(RING)}" />
    <path class="ins" d="${band(INS2)}" />
    <path class="contact" data-part="tip" d="${TIP}" />
    ${PARTS.map((p) => `<path class="lead" data-lead="${p.id}" d="M${p.x} ${Y + R + 6}V${H}" /><circle class="lead-dot" data-lead="${p.id}" cx="${p.x}" cy="${Y + R + 6}" r="1.4" />`).join("")}`;
  fig.appendChild(svg);

  const calls = document.createElement("div");
  calls.className = "trs-calls";
  calls.innerHTML = PARTS.map(
    (p) => `<div class="trs-call" data-part="${p.id}" style="--x:${((p.x / W) * 100).toFixed(2)}%">
      <span class="trs-part">${p.id}</span><span class="trs-role"></span><span class="trs-pin"></span></div>`,
  ).join("");
  fig.appendChild(calls);
  host.appendChild(fig);

  const set = (id: string, role: keyof typeof ROLE) => {
    svg.querySelector(`.contact[data-part="${id}"]`)!.setAttribute("data-role", role);
    svg.querySelectorAll(`[data-lead="${id}"]`).forEach((e) => e.setAttribute("data-role", role));
    const c = calls.querySelector<HTMLElement>(`[data-part="${id}"]`)!;
    if (c.dataset.role === role) return;
    c.dataset.role = role;
    // the words change with a short fade
    c.classList.remove("swap");
    void c.offsetWidth;
    c.classList.add("swap");
    c.querySelector(".trs-role")!.textContent = ROLE[role].name;
    c.querySelector(".trs-pin")!.textContent = ROLE[role].pin;
  };
  return (t) => {
    fig.dataset.type = t;
    set("sleeve", "gnd");
    set("ring", t === "a" ? "v" : "data");
    set("tip", t === "a" ? "data" : "v");
  };
}
