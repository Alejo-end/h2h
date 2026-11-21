// Reads the numbers and colours the site shows from H2H's firmware source, so the page
// says what the firmware does and not what it did once.
//
//   node tools/firmware.mjs <MIDI2HOST.ino> > src/firmware.json
//
// Every value must be found: a renamed constant stops the build instead of a stale page.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('usage: firmware.mjs <MIDI2HOST.ino>');
const src = fs.readFileSync(file, 'utf8');

function must(re, what) {
  const m = src.match(re);
  if (!m) throw new Error(`firmware.mjs: ${what} not found in ${file}`);
  return m;
}
const def = (name) => Number(must(new RegExp(`#define\\s+${name}\\s+(\\d+)`), name)[1]);
const rgb = (name) => must(new RegExp(`const Rgb ${name}\\s*=\\s*\\{\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\s*\\}`), name).slice(1, 4).map(Number);
// a colour written inline in one case of anim_task()
const animRgb = (anim) =>
  must(new RegExp(`case ${anim}:[\\s\\S]*?Rgb\\{\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\s*\\}`), `${anim} colour`).slice(1, 4).map(Number);
const animMs = (anim) => Number(must(new RegExp(`case ${anim}:[\\s\\S]*?if \\(t > (\\d+)\\)`), `${anim} length`)[1]);

const secret = must(/SECRET\[\]\s*=\s*\{([\d,\s]+)\}/, 'the note egg')[1].split(',').map((s) => Number(s.trim()));
const presses = Number(must(/static uint32_t presses\[(\d+)\]/, 'the panic egg')[1]);
const pressWindow = Number(must(/millis\(\) - presses\[k\] < (\d+)/, 'the panic egg window')[1]);

const fw = {
  version: must(/#define FW_VERSION "([^"]+)"/, 'FW_VERSION')[1],
  midiInToBothHosts: def('MIDI_IN_TO_BOTH_HOSTS') === 1,
  led: {
    idle: def('LED_IDLE'),
    max: def('LED_MAX'),
    flashMs: def('FLASH_MS'),
    panicFlashMs: def('PANIC_FLASH_MS'),
    breathMs: def('BREATH_MS'),
    boot: rgb('RGB_BOOT'),
    usbOut: rgb('RGB_USB_OUT'),
    linkIn: rgb('RGB_LINK_IN'),
    dinIn: rgb('RGB_DIN_IN'),
    panic: rgb('RGB_PANIC'),
    handshake: animRgb('ANIM_HANDSHAKE'),
    handshakeMs: animMs('ANIM_HANDSHAKE'),
    mismatch: animRgb('ANIM_MISMATCH'),
    mismatchMs: animMs('ANIM_MISMATCH'),
    partyMs: animMs('ANIM_PARTY'),
  },
  sysexMax: def('SYSEX_MAX'),
  linkBaud: def('LINK_BAUD'),
  linkFifo: def('LINK_RX_FIFO'),
  linkDeadUs: def('LINK_DEAD_US'),
  linkProbeUs: def('LINK_PROBE_US'),
  linkProbeOnUs: def('LINK_PROBE_ON_US'),
  linkJunkMax: def('LINK_JUNK_MAX'),
  linkJunkWindowMs: def('LINK_JUNK_WINDOW_MS'),
  linkQuietMs: def('LINK_QUIET_MS'),
  linkPingMs: def('LINK_PING_MS'),
  trsSteadyMs: def('TRS_STEADY_MS'),
  panicSteadyMs: def('PANIC_STEADY_MS'),
  watchdogMs: def('WATCHDOG_MS'),
  egg: { notes: secret, presses, pressWindowMs: pressWindow },
};
process.stdout.write(JSON.stringify(fw, null, 2) + '\n');
