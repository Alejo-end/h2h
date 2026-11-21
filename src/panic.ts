// The panic readout: what one press sends, message by message, to each output.
//
// From the firmware (send_panic): each output first gets a note off (80 nn 00) for every
// note it sent that is still on, then, channel by channel from 1 to 16, sustain off
// (CC 64 = 0), all sound off (CC 120) and all notes off (CC 123). MIDI OUT sends without
// running status: 3 bytes at 31250 baud, 0.96 ms a message. USB carries each message in a
// 4 byte USB MIDI packet. Host blue's controllers cross the 1 Mbaud link: 30 µs each.
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, "0");
const CCS = [
  [64, "sustain off"],
  [120, "all sound off"],
  [123, "all notes off"],
] as const;
const MS_PER_MSG = (3 * 10) / 31.25; // 3 bytes of 10 bits at 31250 baud: 0.96 ms
const SLOW = 25; // the replay runs this many times slower than MIDI OUT
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

export type PanicTo = { blue: boolean; red: boolean; out: boolean };
export type Held = { blue: Set<number>; red: Set<number>; out: Set<number> };

export function mountPanic(host: HTMLElement) {
  host.innerHTML = `
    <table class="pr-outs">
      <thead><tr><th scope="col">output</th><th scope="col">messages</th><th scope="col">bytes</th><th scope="col">time</th></tr></thead>
      <tbody>
        <tr data-out="blue"><th scope="row"><i class="dot dot-blue"></i>host blue</th><td class="n">0</td><td class="b">0</td><td class="t">idle</td></tr>
        <tr data-out="red"><th scope="row"><i class="dot dot-red"></i>host red</th><td class="n">0</td><td class="b">0</td><td class="t">idle</td></tr>
        <tr data-out="out"><th scope="row"><i class="dot dot-out"></i>midi out</th><td class="n">0</td><td class="b">0</td><td class="t">idle</td></tr>
      </tbody>
    </table>
    <div class="pr-notes"><span class="pr-k">note off</span><span class="pr-v">no notes held. Play a few in the routing demo first.</span></div>
    <div class="pr-grid" role="img" aria-label="Sixteen channels, each sent sustain off, all sound off and all notes off">
      <span class="pr-corner">ch</span>
      ${Array.from({ length: 16 }, (_, i) => `<span class="pr-ch">${i + 1}</span>`).join("")}
      ${CCS.map(([cc, name]) => `<span class="pr-cc"><b>CC ${cc}</b> ${name}</span>${Array.from({ length: 16 }, (_, ch) => `<i class="pr-cell" data-cc="${cc}" data-ch="${ch}"></i>`).join("")}`).join("")}
    </div>
    <p class="pr-wire"><span class="pr-bytes">-- -- --</span><span class="pr-clock">0.0 ms</span><span class="pr-slow">midi out, replayed ${SLOW}× slower</span></p>`;
  const $ = <T extends Element = HTMLElement>(s: string) => host.querySelector<T>(s)!;
  const cells = [...host.querySelectorAll<HTMLElement>(".pr-cell")];
  let raf = 0;

  return function fire(to: PanicTo, held: Held) {
    cancelAnimationFrame(raf);
    cells.forEach((c) => c.classList.remove("on", "sent"));
    // the readout for each output
    const row = (k: keyof PanicTo, live: boolean, t: (n: number) => string, bytesPer: number) => {
      const r = $(`tr[data-out="${k}"]`);
      const n = live ? held[k].size + 48 : 0;
      r.classList.toggle("off", !live);
      r.querySelector(".n")!.textContent = String(n);
      r.querySelector(".b")!.textContent = String(n * bytesPer);
      r.querySelector(".t")!.textContent = live ? t(n) : "not there";
    };
    row("blue", to.blue, () => `link ${((48 * 30) / 1000).toFixed(2)} ms, then USB`, 4);
    row("red", to.red, () => "USB", 4);
    row("out", to.out, (n) => `${(n * MS_PER_MSG).toFixed(2)} ms`, 3);
    // the note offs: the union of what each output still holds
    const notes = [...new Set([...held.blue, ...held.red, ...held.out])].sort((a, b) => a - b);
    $(".pr-notes .pr-v").innerHTML = notes.length
      ? notes.map((n) => `<span class="pr-note"><b>${noteName(n)}</b> 80 ${hex(n)} 00</span>`).join("")
      : "none held, so none sent.";
    // the controllers, replayed in MIDI OUT's own time, slowed down
    const seq: { bytes: number[]; cell?: HTMLElement }[] = [
      ...(to.out ? [...held.out] : notes).map((n) => ({ bytes: [0x80, n, 0] })),
      ...Array.from({ length: 16 }, (_, ch) => CCS.map(([cc]) => ({ bytes: [0xb0 | ch, cc, 0], cell: cells.find((c) => c.dataset.cc === String(cc) && c.dataset.ch === String(ch)) }))).flat(),
    ];
    const bytes = $(".pr-bytes"), clock = $(".pr-clock");
    if (reduce) {
      cells.forEach((c) => c.classList.add("sent"));
      clock.textContent = `${(seq.length * MS_PER_MSG).toFixed(2)} ms`;
      return;
    }
    const t0 = performance.now();
    let shown = 0;
    const step = (now: number) => {
      const wire = (now - t0) / SLOW; // MIDI OUT time, in ms
      const k = Math.min(seq.length, Math.floor(wire / MS_PER_MSG) + 1);
      for (; shown < k; shown++) {
        const cell = seq[shown].cell;
        cell?.classList.add("on");
        if (cell) setTimeout(() => cell.classList.replace("on", "sent"), 140);
        bytes.textContent = seq[shown].bytes.map(hex).join(" ");
      }
      clock.textContent = `${Math.min(wire, seq.length * MS_PER_MSG).toFixed(2)} ms`;
      if (wire < seq.length * MS_PER_MSG) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
}
