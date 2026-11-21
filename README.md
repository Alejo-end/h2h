# h2h-site

The website of H2H, a USB MIDI bridge for two computers with a MIDI IN and a MIDI OUT.
The device comes apart and goes together as you scroll. Then each section turns it to the
part it talks about, and the demos run a small model of the firmware: the routing, the
cable switch, the TRS type switch, the panic button and the status lights.

Live at https://alejo-end.github.io/h2h/. To ask for a unit, open an issue with the
"Ask for an H2H" form.

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm run build      # the static site in dist/
```

## The parts

- `src/h2h-device.ts`: `<h2h-device>`, the device in three.js. Set `progress` (0 apart,
  1 together), `view` (a name from `VIEWS`), `shift` (0 centred, 1 beside the words), and
  call `setSlider` and `press` for the switches and the panic button.
- `src/h2h.ts`: the firmware model. It knows which module has power, where a message goes
  and what each LED shows.
- `src/diagram.ts`: the routing diagram, drawn like the art on the top plate.
- `src/firmware.json`: the colours, times and limits, read from the firmware source by
  `tools/firmware.mjs`. If a constant is renamed in the firmware, the script stops.

## Where the assets come from

- `public/model/h2h.glb` is built from the CAD project, which is private, by a local script
  kept out of this repository (`tools/private/`, git ignored). It runs kicad-cli for the
  board and the plates, FreeCAD for the printed case, then `tools/plates.mjs` (the plate art
  as textures, from KiCad's own layer plots) and `tools/assemble.mjs` (glTF-Transform).
- `public/photos/` are photos of a built unit, prepared with `tools/photos.mjs`.

## Deploy

`tools/deploy.sh` builds the site with `BASE=/h2h/` and pushes `dist/` to the `gh-pages`
branch, which GitHub Pages serves. `tools/pages.yml.disabled` is the GitHub Actions
workflow that four-site uses. To build on every push instead, move it to
`.github/workflows/pages.yml` and set Pages to deploy from GitHub Actions.
