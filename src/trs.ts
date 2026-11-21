// The TRS demo: a 3.5 mm plug in H2H's MIDI OUT jack, drawn to scale, and the A/B switch
// between the jack's contacts and the two MIDI OUT lines.
//
// Type A: ring = +V source (DIN pin 4), tip = data (DIN pin 5). Type B swaps tip and ring.
// The sleeve is ground (DIN pin 2) on both.
const NS = "http://www.w3.org/2000/svg";

// the plug, in mm from where the sleeve leaves the body: sleeve 6.6, insulator 1.0, ring
// 2.5, insulator 1.0, then the tip: a neck the jack's spring sits in, the full 3.5 mm
// shoulder and the cone. 14.9 mm in all, 3.5 mm across.
const S = 5.2; // units per mm
const Y = 34; // the plug's axis
const R = 1.75 * S;
const x0 = 44;
const at = (mm: number) => x0 + mm * S;
const SLEEVE: [number, number] = [at(0), at(6.6)];
const INS1: [number, number] = [at(6.6), at(7.6)];
const RING: [number, number] = [at(7.6), at(10.1)];
const INS2: [number, number] = [at(10.1), at(11.1)];
const TIP_D = (() => {
  const a = at(11.1), neck = at(12.1), sh0 = at(12.5), sh1 = at(13.2), cone = at(14.5), end = at(14.9);
  const rn = 1.25 * S, rc = 0.5 * S;
  return `M${a} ${Y - rn}H${neck}L${sh0} ${Y - R}H${sh1}L${cone} ${Y - rc}Q${end} ${Y} ${cone} ${Y + rc}L${sh1} ${Y + R}H${sh0}L${neck} ${Y + rn}H${a}Z`;
})();
const rect = ([a, b]: [number, number]) => `M${a} ${Y - R}H${b}V${Y + R}H${a}Z`;

export function mountTrs(host: HTMLElement): (t: "a" | "b") => void {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 86");
  svg.setAttribute("class", "trs");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "A 3.5 mm TRS plug in H2H's MIDI OUT jack. The jack's tip and ring springs go through the A/B switch to the data line and the +V source; the sleeve is ground.");
  const tipX = at(11.6), ringX = at(8.85), sleeveX = at(3.3);
  svg.innerHTML = `
    <defs>
      <linearGradient id="trs-metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8d8983" /><stop offset="0.22" stop-color="#f4f1ea" /><stop offset="0.45" stop-color="#c3beb4" />
        <stop offset="0.78" stop-color="#6b6760" /><stop offset="1" stop-color="#9a958c" />
      </linearGradient>
      <linearGradient id="trs-copper" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9c6447" /><stop offset="0.22" stop-color="#ffd3b3" /><stop offset="0.5" stop-color="#d1916b" />
        <stop offset="0.8" stop-color="#7a4b33" /><stop offset="1" stop-color="#a8704f" />
      </linearGradient>
      <linearGradient id="trs-body" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2a2a2e" /><stop offset="0.3" stop-color="#3a3a40" /><stop offset="1" stop-color="#0e0e10" />
      </linearGradient>
      <filter id="trs-glow" x="0" y="0" width="200" height="86" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="1.6" /></filter>
    </defs>
    <rect class="jack" x="${at(0.9)}" y="12" width="${at(16) - at(0.9)}" height="44" rx="2.5" />
    <g class="plug">
      <rect x="-12" y="${Y - 5}" width="26" height="10" rx="5" fill="url(#trs-body)" />
      <path d="M12 ${Y - 13}Q12 ${Y - 16} 15 ${Y - 16}H${x0 - 2}Q${x0} ${Y - 16} ${x0} ${Y - 14}V${Y + 14}Q${x0} ${Y + 16} ${x0 - 2} ${Y + 16}H15Q12 ${Y + 16} 12 ${Y + 13}Z" fill="url(#trs-body)" />
      ${[18, 22, 26, 30, 34, 38].map((x) => `<path class="grip" d="M${x} ${Y - 15}V${Y + 15}" />`).join("")}
      <path class="metal" d="${rect(SLEEVE)}" />
      <path class="ins" d="${rect(INS1)}" />
      <path class="metal" d="${rect(RING)}" />
      <path class="ins" d="${rect(INS2)}" />
      <path class="metal" d="${TIP_D}" />
      <g class="role" data-part="ring"><path class="glow" d="${rect(RING)}" /><path class="fill" d="${rect(RING)}" /></g>
      <g class="role" data-part="tip"><path class="glow" d="${TIP_D}" /><path class="fill" d="${TIP_D}" /></g>
    </g>
    <g class="springs">
      <polyline points="${sleeveX - 8},12 ${sleeveX},${Y - R} ${sleeveX + 8},14" />
      <polyline points="${ringX - 8},56 ${ringX},${Y + R} ${ringX + 8},54" />
      <polyline points="${tipX - 6},56 ${tipX},${Y + 1.25 * S} ${tipX + 6.5},54" />
    </g>
    <g class="letters">
      <text x="${sleeveX}" y="${Y + R + 9}" text-anchor="middle">S</text>
      <text x="${ringX}" y="${Y - R - 5}" text-anchor="middle">R</text>
      <text x="${tipX + 3}" y="${Y - R - 5}" text-anchor="middle">T</text>
    </g>
    <g class="nets">
      <path class="net net-gnd" d="M${sleeveX - 8} 12V6H160" />
      <path class="net net-tip" d="M${tipX - 6} 56V62H140" />
      <path class="net net-ring" d="M${ringX - 8} 56V74H140" />
      <rect class="sw" x="140" y="55" width="20" height="26" rx="2" />
      <rect class="knob" x="142.2" y="56.6" width="7.2" height="2.6" rx="0.9" />
      <path class="net wire wire-a net-data" d="M140 62H160" />
      <path class="net wire wire-a net-v" d="M140 74H160" />
      <path class="net wire wire-b net-v" d="M140 62C148 62 152 74 160 74" />
      <path class="net wire wire-b net-data" d="M140 74C148 74 152 62 160 62" />
      <path class="net net-data" d="M160 62H168" />
      <path class="net net-v" d="M160 74H168" />
      <path class="net net-data flow" d="M160 62H168" />
    </g>
    <g class="words">
      <text x="170" y="8">ground</text>
      <text class="w-data" x="170" y="64">data</text>
      <text class="w-v" x="170" y="76">+V</text>
      <text class="sw-a" x="145.8" y="52" text-anchor="middle">a</text>
      <text class="sw-b" x="154.2" y="52" text-anchor="middle">b</text>
      <text x="${at(0.9)}" y="84">midi out jack</text>
    </g>`;
  host.appendChild(svg);

  // the table: which contact does what, for each type
  const table = document.createElement("table");
  table.className = "trs-map";
  table.innerHTML = `
    <thead><tr><th scope="col"><span class="vh">Type</span></th><th scope="col">tip</th><th scope="col">ring</th><th scope="col">sleeve</th></tr></thead>
    <tbody>
      <tr data-type="a"><th scope="row">type a</th><td class="r-data">data <span>pin 5</span></td><td class="r-v">+V source <span>pin 4</span></td><td>ground <span>pin 2</span></td></tr>
      <tr data-type="b"><th scope="row">type b</th><td class="r-v">+V source <span>pin 4</span></td><td class="r-data">data <span>pin 5</span></td><td>ground <span>pin 2</span></td></tr>
    </tbody>`;
  host.appendChild(table);

  return (t) => {
    svg.dataset.type = t;
    const ring = svg.querySelector<SVGGElement>('[data-part="ring"]')!, tip = svg.querySelector<SVGGElement>('[data-part="tip"]')!;
    ring.dataset.role = t === "a" ? "v" : "data";
    tip.dataset.role = t === "a" ? "data" : "v";
    // the nets from the springs take the role they carry
    svg.querySelector(".net-tip")!.setAttribute("data-role", t === "a" ? "data" : "v");
    svg.querySelector(".net-ring")!.setAttribute("data-role", t === "a" ? "v" : "data");
    table.querySelectorAll("tr[data-type]").forEach((r) => r.classList.toggle("on", (r as HTMLElement).dataset.type === t));
  };
}
