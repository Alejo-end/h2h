// The TRS demo: a 3.5 mm plug drawn flat and to scale, like a technical drawing, with a callout under each contact that says
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
    <path class="body" d="M0 ${Y - 8}H22V${Y + 8}H0Z" />
    <path class="body" d="${BODY}" />
    <path class="collar" d="${COLLAR}" />
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
