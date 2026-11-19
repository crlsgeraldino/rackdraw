# NetCraft

Free, browser-based network diagrams for documenting client sites — a lightweight Visio alternative for MSPs.
Everything runs in your browser: diagrams are stored locally and never uploaded.

Built the same way as [PDFCraft](https://github.com/PDFCraftTool/pdfcraft): Next.js (App Router) + TypeScript +
Tailwind CSS + Zustand, exported as a static site. The diagram engine is [React Flow](https://reactflow.dev) (MIT).

## Features

- **Real front-panel stencils** — SonicWall TZ570/TZ670, 8/24/48-port switches, 24-port patch panel — where every
  port is a connection point. Plus symbols for ISP, modem/ONT, AP, server, NAS, UPS, workstation, laptop, printer,
  VoIP phone and IP camera.
- **Cables** — drag from port to port. Pick the type (Cat6, Cat5e, Fiber, DAC, WAN, Console, Wireless, VPN), label and VLAN.
  Connected ports light up.
- **Device data** — hostname, model, management IP, serial, location, notes, and per-port description/VLAN.
- **Zones and notes** — resizable rooms/racks and sticky notes.
- **One diagram per client**, switchable from the toolbar, auto-saved in the browser. Save/open `.netcraft.json` files
  to back up or share.
- **Export** — PDF report (diagram + device and connection tables), PNG (Word/email), SVG (Visio, Office, draw.io),
  CSV (Excel).
- Undo/redo (Ctrl+Z / Ctrl+Y), duplicate (Ctrl+D), delete (Del), snap-to-grid, minimap.

## Run locally

Requires Node 18.18+.

```bash
npm install
npm run dev        # http://localhost:3000
```

## Build and host

```bash
npm run build      # static site in out/
```

Copy `out/` to any static web host (IIS, Nginx, GitHub Pages, Netlify, Cloudflare Pages). There is no server component.

## Install it as an app

NetCraft is an installable web app (PWA). Open it in Edge or Chrome and click the **Install** icon in the address bar
(Edge: **⋯ → Apps → Install NetCraft**). You get a Start-menu entry, its own window, and it keeps working offline.
The installed app can also open `.netcraft.json` files.

Installing requires HTTPS, or `localhost` for local testing (`npm run build && npm run serve`, then open
http://localhost:3124).

## Windows desktop app

```bash
npm run desktop     # build and launch the desktop app
npm run dist:win    # build the installer: release/NetCraft-Setup-<version>.exe
```

The desktop app is the same static build wrapped in Electron (`electron/main.cjs`). It serves `out/` from a private
`app://netcraft` origin, so diagrams persist between launches and nothing touches the network.
The installer asks per-user vs. all users; for silent deployment (Intune/RMM) use `NetCraft-Setup-<version>.exe /S`
(add `/allusers` for a per-machine install).

The installer is not code-signed, so SmartScreen will warn on first run until it's signed with a code-signing certificate.

## License

[MIT](LICENSE)

## Pages

Each client project has **pages**, shown as tabs under the canvas (like Visio):

- **＋** adds a **Network diagram** or a **Floor plan** page. Double-click a tab to rename it; its ▾ menu duplicates,
  reorders or deletes the page (undoable).
- Any page can have a **background image**: a floor plan, site photo or rack photo. Set it in the right panel
  (with nothing selected), adjust opacity, and unlock it to move or resize it.
- Cables connect devices on the same page. Racks belong to the client, so they can hold devices from any page,
  and **Show on diagram** jumps to the right page.
- The PDF gets one picture per page; device and connection tables list the page each item is on.
- Diagrams saved by v0.2 open as a single "Network" page.

## Spreadsheet data (Excel / CSV)

The **Data** menu links devices to a spreadsheet, like Visio's *Link Data to Shapes*:

- **Export device list (CSV)** writes one row per device with a **NetCraft ID** column. Edit it in Excel (IPs, MACs,
  serials, asset tags, locations, power, notes; add rows for new devices) and import it back.
- **Import from Excel / CSV…** reads `.xlsx` or `.csv`, auto-maps columns by their headers (Hostname, IP Address,
  Serial Number, Service Tag, Asset Tag, MAC…), matches rows to devices by ID, name, asset tag, serial, IP or MAC,
  and shows a preview of every change before applying. Empty cells never erase existing values. Optionally adds
  devices for unmatched rows, choosing the stencil from a Type column.
- **Refresh** re-applies the same sheet with the same mapping after you edit it. In Edge/Chrome the app re-reads the
  file itself (after you allow it); elsewhere it asks you to pick the file again. Imports are undoable.

## Racks

Switch to **Racks** in the toolbar to draw rack elevations for the client.

- **+ Add rack** in any standard size (6U–48U); several racks per client.
- Drag devices from **On the diagram, not racked** into the rack, or drag a **New device** in (it is added to the
  diagram too). Drag **accessories** in: blanking panels, cable managers, shelves, PDUs.
- Front and rear views side by side. Items are **full depth** (both faces) or **front/rear only**, so a rear PDU can
  share a unit with a front blanking panel. Overlaps and out-of-rack positions are refused.
- Drag mounted items to move them; set U position, height and depth precisely in the right panel.
- A mounted device is the same device as on the diagram: name, model, IP, serial, **asset tag** and **power (W)** are
  shared, and the diagram's properties panel links to its rack position.
- The rack panel totals used/free units and power draw.
- Exports: the **PDF** gets a front/rear elevation page per rack and a **Rack contents** table; the **CSV** gets a
  RACKS section and rack positions in the device list.

## Your own stencils (no code needed)

**My stencils → + Import image as device** takes an SVG, PNG, JPG or WebP — a vendor product photo, a datasheet
drawing, or a Visio shape exported as SVG (in Visio: select the shape → **File → Save As → SVG**). Then drag a box over
each port; every box becomes a connection point with a label, type (RJ45, SFP, console, power…), cable direction and
optional role (WAN, LAN, MGMT). Set how wide it should appear on the diagram and save.

- Hover a stencil in the palette to **✎ edit** its ports or **✕ delete** it.
- **Export library** saves all your stencils to one `.netcraft-stencils.json` file; techs load it with **Import library**.
- Saved project files embed the custom stencils they use, so a diagram opens correctly on any computer.
- Large photos are resized to 2000 px and re-encoded as WebP; SVGs containing scripts are refused.
- Stencils and diagrams are stored in the browser's IndexedDB (diagrams saved by v0.1 move over automatically).

Vendor artwork keeps its own license: import it for your own documentation, but don't bundle it in this repository.

### Visio stencils (.vssx)

**My stencils → + Import Visio stencil (.vssx)** opens a vendor stencil (Dell, Ubiquiti, HPE, Cisco…), lists its
shapes with a live preview, and imports the ones you tick into a category you choose.

- Works without Visio, entirely in the browser. Also reads the masters inside `.vsdx` drawings and `.vstx` templates.
- Draws Visio geometry (lines, arcs, elliptical arcs, Béziers, ellipses), groups, rotation/flips, line and fill
  styles, simple text, and embedded **PNG/JPG/GIF/BMP** pictures.
- Converts embedded **EMF** pictures (the format most vendor stencils use) with a built-in EMF→SVG converter:
  paths, polygons, Béziers, pens, brushes, world transforms, clipping, text and bitmaps.
- Visio **connection points become cable ports** automatically; rename them later with ✎.
- 19" gear (16.5–19.5" wide) gets a **rack height** from its height (1U = 1.75").
- Old binary `.vss`/`.vsd` files aren't supported: open them in Visio and save as `.vssx`. EMF+-only pictures and
  WMF pictures are skipped with a note.

## Adding a built-in stencil

Built-in stencils live in `src/lib/stencils.tsx`. A panel stencil is a native-size artwork plus a list of ports
(`id`, `label`, `kind`, `x`, `y`, `w`, `h`, `side`); each port automatically becomes a connection point and a row in the
properties panel. See `sonicwallTz` and `switchStencil()` for examples.

## Project layout

```
src/
  app/                 Next.js entry (static page that loads the editor client-side)
  components/          Editor, toolbar, palette, properties panel, node and cable renderers
  lib/stencils.tsx     Device catalog and artwork
  lib/export.ts        PDF / PNG / SVG / CSV export and project files
  lib/types.ts         Data model
  store/               Zustand store (projects, history, persistence)
```
