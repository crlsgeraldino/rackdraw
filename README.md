# NetCraft

Free, browser-based network diagrams for documenting client sites — a lightweight Visio alternative for MSPs.
Everything runs in your browser: diagrams are stored locally and never uploaded.

Built the same way as [PDFCraft](https://github.com/PDFCraftTool/pdfcraft): Next.js (App Router) + TypeScript +
Tailwind CSS + Zustand, exported as a static site. The diagram engine is [React Flow](https://reactflow.dev) (MIT).

## Features

- **Real front-panel stencils** — SonicWall TZ570/TZ670, 8/24/48-port switches, 24-port patch panel — where every
  port is a connection point. Plus symbols for ISP, modem/ONT, AP, server, NAS, UPS, workstation, laptop, printer,
  VoIP phone and IP camera.
- **Cables** — drag from port to port. Pick the type (Cat6, Cat5e, Fiber, DAC, WAN, Console, Wireless, VPN), label,
  VLAN and line color. Right-angle cables route **around devices** instead of through them. Connected ports light up.
- **Device labels** — choose what each device shows (name, IP, model, location, serial, or nothing) and drag the label
  wherever it reads best.
- **Device data** — hostname, model, management IP, serial, location, notes.
- **Port notes** — for every port: what's plugged in (even devices you don't draw: printers, cameras, phones, the
  ISP handoff), its IP and VLAN, an **uplink** flag and notes. Shown on hover, marked on the device, and listed in
  the PDF, printout and CSV.
- **Info boxes** — a printable box beside any device with the details you pick (model, IP, serial, your own fields
  like WAN IP / LAN subnet / gateway) and what each port connects to (uplinks, printers, APs…).
- **Quick info** — hover a device for a floating card with its IP (copy / open), serial, rack, ports in use and
  port notes. Turn it off under **View → Quick info on hover**.
- **Zones and notes** — resizable rooms/racks and sticky notes.
- **One diagram per client**, switchable from the toolbar, auto-saved in the browser. Save/open `.netcraft.json` files
  to back up or share.
- **Export** — PDF report (diagram + device and connection tables), PNG (Word/email), SVG (Visio, Office, draw.io),
  CSV (Excel).
- Undo/redo (Ctrl+Z / Ctrl+Y), cut/copy/paste (Ctrl+X/C/V), duplicate (Ctrl+D), delete (Del), snap-to-grid, minimap.
- **Arrange** — align, distribute, group, bring to front / send to back, lock, **auto-arrange** (top down by
  cabling), **format painter** (copy/paste format).
- **Line jumps** — where cables cross, one hops over the other, like Visio.
- **Check diagram** — finds duplicate IPs and names, ports with two cables, unconnected uplinks, VLAN mismatches,
  overlapping devices, missing stencils, broken links and missing details; click a problem to go to it.
- **Find & replace** (Ctrl+F / Ctrl+H) across every page: names, IPs, serials, port notes, VLANs, labels.
- **Hyperlinks** on devices, shapes and zones: a device's web UI, a ticket, or another page.
- **Print** (Ctrl+P) and PDF with a **title block** on every sheet: client, site, drawing, prepared by, revision,
  date, page X of Y.

## The window (laid out like Visio)

- **Ribbon** across the top, with the Quick Access Toolbar (Save, Undo, Redo) and the client picker in the title
  bar. Tabs: **File** (new, open, save, print, export PDF/PNG/SVG/CSV, delete), **Home** (clipboard, format painter,
  text/dimension/zone tools, fill and line colour, align/distribute/order/group/lock/auto-arrange, find/replace/
  select all), **Insert** (pages, floor-plan picture, image/Visio/library imports, shapes, zone, note, dimension),
  **Design** (page size and orientation, drawing scale, title block, line jumps, data colours, legend, info boxes),
  **Data** (Shape Data pane, Excel link, layers, Check Diagram), **Review** and **View** (diagram/racks, zoom,
  rulers, grid, page breaks, Pan & Zoom, task panes). Selecting something adds a **Shape** tab for it.
  Ctrl+F1 collapses the ribbon.
- **Shapes** window on the left: search, **More Shapes** (Visio stencil import, image import, stencil libraries),
  your libraries and the built-in stencils as folding title bars.
- **Drawing page**: a white page of the chosen paper size that grows by whole sheets to fit the drawing, with grid,
  dashed page breaks and **rulers** (inches, cm, or the page's drawing scale).
- **Shape Data** pane on the right with folding sections (Shape Data, Ports, Display, Size & Position); with nothing
  selected it shows the page and client.
- **Status bar**: page number, the selection's size and position, zoom slider, 100%, fit page, Pan & Zoom.

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

## Templates (File → New client)

- Like Visio's template gallery: start from a **Blank drawing**, a **Small office network** (ISP → firewall → PoE switch
  → access points, workstations, printer, NAS, all cabled), a **Server rack** (cabled and mounted in a 24U rack with
  cable managers and a PDU) or an **Office floor plan** (a 40 × 30 ft room to scale with walls, door and window).
  They use only the built-in stencils.
- **File → Save as template…** turns the current client into your own starting point (client details are left
  out); it appears under **My templates** in File → New. Hover a template there and click ✕ to delete it.

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
- **Background pages** (like Visio's): **＋ → Background page** adds one and puts it behind every page that has no
  background yet. Draw the title block, logo or border there once. Each page picks its background in its tab menu
  (▾ → Background), and any page can be turned into a background page and back. Background items show behind the
  page, can't be selected from it, and appear in its prints, PDF, pictures and Word report; background pages aren't
  printed on their own.
- **Design → Themes** (Office, Slate, Ocean, Forest, Sunset, Monochrome): one click recolours this page's drawing
  shapes, callouts and zones; the ▾ applies a theme to every page. New shapes use the theme. Devices and cables
  keep their colours.
- **Drawing scale and measuring** (floor plans): with nothing selected, **Set scale…** in the right panel, click two
  points a known distance apart on the plan (both sides of a door, a wall), and type the real distance
  (`30 ft`, `12' 6"`, `9.5 m`, `250 cm`). Or type it as *100 units = … feet/metres*.
- **Dimension line** (palette → Layout): drag it onto the page, drag its ends (Shift keeps it straight); it shows the
  real length, with an optional label.
- **Floor Plan** stencil (Shapes window, or Insert → Floor Plan): **walls** you stretch by their ends (thickness in
  the panel; the length shows while selected), **doors** with their swing (rotate in 90° steps, swing the other way)
  and **windows** you stretch along a wall. They go into Visio exports too.
- **Cable lengths**: a cable's **Length** can be typed, or measured from the scaled drawing with one click (**Use
  42' 6"**); tick *Show length on the cable* to label it. Lengths appear in the connections table of the PDF,
  printout and CSV, handy for cable estimates.

## Drawing tools and connectors

- **Drawing** shapes in the palette: text, box, rounded box, ellipse, diamond and arrow. Resize with the corner
  handles, double-click to edit text, and set fill, border, text color/size, dashed border and arrow direction in the
  right panel.
- Drag from a shape's blue edge dot to draw an arrow to another shape or device. Links that touch a shape are plain
  arrow lines; device-to-device links stay network cables.
- Any line or cable can be routed with **right angles, straight or curved**, and get **arrowheads** at the start,
  end or both. Right-angle routes leave the port straight out of the device, then take the shortest path with the
  fewest bends that keeps clear of every device, note and shape on the page, and re-route as you move things.
- **Line color**: pick a color for a cable (or several selected cables) in the right panel; **Auto** goes back to
  coloring by cable type or VLAN (View menu). Dashes and thickness still follow the cable type.
- **Device labels**: in the right panel, *Show on the diagram* picks the fields under a device (name, IP, model,
  location, serial; untick all to hide the label). Works on several selected devices at once. Drag a label on the
  canvas to move it; *Reset position* puts it back.

## Port notes and quick info

- Select a device; the **Ports** list in the right panel shows every port with what's connected, its IP, VLAN and an
  **UPLINK** badge. Click a port to fill in *Connected to*, *IP*, *VLAN*, *Uplink port* and *Notes*. Ports with a
  cable show where it goes; **In use** hides empty ports (handy on 48-port switches).
- On the diagram, uplink ports get an orange frame and other documented ports a small blue dot; hovering a port
  shows its notes.
- The PDF, printout and CSV get a **Port notes** table (device, port, uplink, connected to, IP, VLAN, notes), and
  **Find** searches port IPs and notes too.
- **Quick info**: rest the pointer on a device to see a card with its status, model, IP (Copy / Open its web page),
  MAC, serial, asset tag, location, rack position, layer, power, ports in use, link, notes and port notes. The card
  stays open while you point at it. **View → Quick info on hover** turns it off (remembered on this computer).

## Info boxes (printed device details)

- Select a device and tick **Info box on the diagram** (right panel). A box appears beside it with the device name
  and the details you tick: model, IP, MAC, serial, asset tag, location, **My fields** and notes.
- **My fields** (right panel, under the serial number) are your own name/value pairs for that device: WAN IP,
  LAN subnet, gateway, DNS, DHCP range, ISP, circuit ID, firmware, Wi-Fi SSID… (suggestions offered as you type).
- **Ports** in the box: *All in use* lists every port with a cable or notes (uplinks first) and what it connects to,
  e.g. `X1 UP → Pilot Fiber ONT · 203.0.113.10`, `5 → Front desk printer · 10.0.0.50`; or *Uplinks only*, or *None*.
  What you typed in *Connected to* is shown, with the cable's far end in brackets when it differs.
- Drag a box to place it; *Reset position* puts it back. Select several devices to set them all at once, or use
  **View → Info boxes on all devices: Show / Hide**.
- Info boxes are part of the diagram: they print, and the PDF/PNG/SVG pictures are widened so boxes and labels
  aren't cut off.

## Editing like Visio

- **Dynamic grid**: while you drag, items snap into line with others — left, centre, right, top, middle or bottom —
  and blue guides show the alignment. Turn it off under **View → Dynamic grid**.
- **Rotate** drawing shapes, text and freehand drawings by dragging the round handle above the selected shape
  (whole degrees, 15° steps with Shift, snaps to 0/90/180/270), or type the **Angle** in the right panel.
  A turned shape's resize handles turn with it, and the opposite side stays put while you drag one.
- **Rotate devices** to any angle: drag the round handle above the selected device (whole degrees, 15° steps with
  Shift, catches 0/90/180/270), type the **Angle** under Size & Position, or use **Home → Arrange → Rotate Right /
  Rotate Left** (90°) or right-click → Rotate. The ports turn with the picture, so cables leave from the right
  place; the label stays upright below. Saved to `.vsdx` with Visio's angle.
- **Arrow keys** nudge the selection one grid step (Shift: one pixel). **View → Snap to grid** turns grid snapping off.
- **Drag a page tab** left or right to reorder pages.
- **Data Graphics** (Data tab): show any field on every device — as a small text tag (e.g. Model, Firmware, ISP) or an
  icon (✔ / ✘ for Yes / No fields, a coloured dot for Status). They print and export with the diagram.
- **Select by type** (Home → Editing → Select ▾): Select All, same type as the selection (e.g. every Pro Max 48),
  all devices, all cables, all drawing shapes, all text, all zones, or everything on a layer.
- **ScreenTips** (Insert → ScreenTip, or right-click): hover text for any item; a device's tip shows at the top of its
  quick info card.
- In **Full Screen**, clicking an item with a hyperlink follows it (another page or a web address).
- **One cable per port**: a device port that already has a cable turns red when you drag another one over it and won't
  take it (drawing shapes still take any number of lines). Check Diagram lists ports used twice in older drawings.
- **Move a cable's end**: select the cable and drag either end onto another port (like moving a glued Visio connector).
- **AutoConnect** (Visio's blue arrows): select one device or shape and click one of the four blue arrows around it to
  add a copy on that side, already connected (devices get a Cat6 cable between facing ports, named Server 3, 4…).
- **Favorites**: hover a shape in the Shapes window and click ☆ to pin it to **★ Favorites** at the top (per computer).
- **Connector tool** (Home → Tools): drag from one device or shape to another and a cable joins them at the nearest
  free ports (on a 48-port switch, the free port closest to the other device). Stays on until Esc / Pointer.
- **Shape Style → Quick Styles** (like Visio): 30 ready-made fill / line / text looks — subtle to intense, plus outline
  — in the current theme's colours, for the selected shapes. Shapes and zones also get **W / H** boxes under
  *Position and size* in the right panel.
- **Shape Style → Weight** (0.5–6 px, or Automatic) for cables, shapes and lines, and **Shadow** for shapes. Both are
  saved to `.vsdx`.
- **View → Full Screen** (or **F5**): only the drawing, fitted to the screen; ← / → (or Page Up / Page Down, Space)
  move between pages, **Esc** ends. Background pages show behind their pages and are skipped.
- **Rename a device on the canvas**: double-click its label, type, Enter (Esc cancels).
- **Cable text**: drag a cable's label along the cable to move it; double-click it to put it back in the middle.
  The position is kept in exports and `.vsdx`.
- **Home → Tools**: **Line** (drag to draw; Shift keeps it straight) and **Pencil** (freehand) stay on until you pick
  **Pointer** or press Esc. Lines get a colour, width, dashes and arrowheads in the right panel; both can go on
  layers and are saved to `.vsdx`.
- **Copy / cut / paste** (Ctrl+C / Ctrl+X / Ctrl+V, or the **Arrange** menu) copies devices, shapes, notes and zones
  together with the cables between them. Paste on another page, another client, or another NetCraft window; each
  paste lands a little further down-right. Pasting into Notepad or a ticket gives one line per device
  (name, IP, model, serial).
- **Arrange** menu (also in the right panel when several items are selected): align left/center/right/top/middle/
  bottom, distribute horizontally/vertically (equal gaps, first and last stay put), **group** (Ctrl+G) and
  ungroup (Ctrl+Shift+G), **bring to front** (Ctrl+Shift+F) and **send to back** (Ctrl+Shift+B).
  Select several items with Shift+click, or Shift+drag a box.
- A **group** is selected and moved as one; ungroup to edit the members on their own.
- **Lock position** keeps items from being moved, resized, deleted or aligned (handy for a wall-mounted rack or a
  room outline). Locked items can still be selected and edited; unlock them from the Arrange menu or the right panel.
- **Find** (Ctrl+F) searches every page of the client: device name, model, IP, MAC, serial, asset tag, location,
  notes, links, port descriptions and VLANs, zone titles, notes, shape text, and cable labels/VLANs.
  Enter / Shift+Enter step through results and zoom to each one. **Replace** (Ctrl+H, or ▸ in the find bar)
  replaces in one field or in all of them at once; Ctrl+Z undoes it.
- **Links**: set a device's, shape's or zone's **Link** in the right panel to a web address (a bare IP or host name
  opens as `https://…`, handy for a device's web UI), `mailto:`, or **another page** of the client. A link button
  appears on the item; click it to follow the link (the desktop app opens web links in your default browser).

## Editing a device's shape (like Visio's Edit Master)

- **Double-click a device**, or right-click it → **Edit shape & ports…**, or **Edit shape…** in the right panel.
- In the shape editor, click any port to rename it, change its type (RJ45, SFP, console…), the side its cable leaves
  from, or delete it; drag a box to add a port. You can also change the shape's name, library, size on the diagram
  and rack height. Cables stay plugged in when you rename ports.
- Like Visio, saving changes every device that uses the shape (the editor says how many). Editing a built-in shape
  makes your own editable copy in **My stencils** and switches just that device to it, so the built-in stays as is.
- To rename a port on one device only, use **Port name on this device** in that port's details (right panel).
- **Right-click** anything on the canvas for its shortcut menu: devices (edit shape, show/hide info box, cut, copy,
  duplicate, order, group, lock, copy/paste format, delete), cables (right angles / straight / curved, format,
  delete) and the empty canvas (paste, check diagram).

## Comments (Review tab)

- Select a device or shape and click **Review → New Comment**; type and **Post** (Ctrl+Enter). Your name is
  remembered on this computer. Shapes with open comments show a 💬 badge; click it to open the comments.
- **Review → Comments** lists every comment in the client, on every page; click an item's name to go to it, and
  **Resolve**, **Reopen** or **Delete** comments. Find (Ctrl+F) searches comments too.

## Text formatting and callouts

- **Home → Font**: font name and size, **B**old, *Italic*, Underline, and A+ / A− for the text of the selected
  shapes, notes and callouts (the font is kept in `.vsdx`). **Home → Paragraph**: align left / center / right and top / middle / bottom.
- **Insert → Callout** (or the Callout tile in the Shapes pane): with a device or shape selected, the callout is
  attached to it — a leader line points at it and the callout moves with it. Change what it points to under
  **Points to** in the right panel. Callouts and text formatting carry over to `.vsdx`.

## PowerPoint slides (.pptx)

- **File → Export → PowerPoint slides**: a title slide (client, site, date), then one 16:9 slide per page and per rack,
  each with its title and a footer — ready for a quarterly review. Opens in PowerPoint, Keynote and Google Slides.

## Word report (.docx)

- **File → Export → Word report (.docx)** writes an editable Word document: client details and title block, a
  picture of every page, every rack elevation, and the Devices, Connections, Rack contents and Port notes tables
  (header rows repeat on each page). Rack elevations go on portrait pages so tall racks stay readable. Opens in
  Word, LibreOffice and Google Docs.

## Tidy-up tools

- Cables end on an icon's picture (the modem's body, the cloud's outline) instead of the empty box around it.

- **Design → Re-Layout Page** (like Visio): lay out the selection or the whole page **Top to bottom**, **Left to
  right**, as a **Compact tree**, **Radial** (core in the middle) or **Circular**, with Tight / Normal / Wide spacing.
  Devices under a switch are put in the order of the ports they use, so their cables don't cross.
- **Parallel cables get their own lanes**: where several right-angle cables would run on the same line (e.g. a switch
  feeding a row of workstations), they're spread a few pixels apart, ordered so the bundle doesn't cross itself.
- **Line jumps**: where two cables cross, the horizontal one hops over the vertical one (prints and exports too).
  Turn off under **View → Line jumps where cables cross**.
- **Arrange → Auto-arrange (top down)** lays out the selected devices (or the whole page) in rows by cabling:
  ISP, firewall, core switch, access switches, then APs/servers/endpoints, each under what it connects to;
  unconnected devices go on the last row. Leaves room for info boxes and labels. Ctrl+Z undoes it.
- **Arrange → Copy format / Paste format** (format painter): copy a cable's type, color, routing and arrows, a
  shape's colors/border/text size, or a device's label fields, info-box settings and status, then paste onto other
  selected items of the same kind.
- **Arrange → Check diagram…** lists problems across every page: duplicate device IPs (also inside `https://…`
  addresses) and names, duplicate port IPs, ports with two cables, uplinks with nothing connected, cable VLANs that
  disagree with the port VLAN, overlapping devices, missing stencils and links to deleted pages; tick *Show missing
  details* for devices without IP, serial or connections. It updates as you edit; click a line to go there.

## Title block and printing

- **Header & footer** (File → Print, or the right panel with nothing selected): left, centre and right text at the top
  and bottom of every printed and PDF sheet, with codes for page number, number of pages, date, client, site, sheet
  title and author. Without one, sheets show "Page n of m".

- In the right panel (with nothing selected), turn on the **Title block** and fill in *Prepared by* (your company),
  *Drawn by*, *Revision* and *Date* (empty = the day you print). Client and site come from the client details.
- The **PDF report** and **Print** then put the title block along the bottom of every sheet, with the drawing name
  and *page X of Y*.
- **Export ▾ → Print…** (Ctrl+P) picks the paper (Letter, Legal, Tabloid, A4, A3) and orientation, and which
  diagram pages, rack elevations and tables to print, then opens the system print dialog (or *Save as PDF*).
  Each diagram is scaled to fit its sheet; long tables continue onto more sheets with the title block repeated.

## Layers, status and data colors

The **View** menu works like Visio's layers and data graphics:

- **Color devices by** status, location, model or layer, and **cables by** type or VLAN. A legend appears on the
  canvas and on each PDF diagram page.
- Every device has a **status** (Active, Planned, Offline, Retired). Planned devices are drawn dashed (handy for
  proposals), retired ones faded.
- **Layers** group devices and cables (e.g. Cameras, Wi-Fi, Power, Planned work). Create them in the View menu, put
  the selection on a layer (or set it in the properties panel), and tick a layer off to hide everything on it, on the
  canvas and in picture/PDF exports. Tables in the PDF/CSV still list everything.
- **Layer properties** (Data → Layers), like Visio's: per layer **Visible**, **Print** (untick to leave it out of
  prints, PDF, pictures and the Word report while still showing it on screen), **Lock** (its devices, shapes and
  cables can't be selected, moved or deleted) and **Active** (new devices, shapes and cables go on it). Shapes can
  be put on layers too.

## Containers

- A **zone** works like a Visio container: drag it and everything inside it moves along (what's inside is decided
  when the drag starts, so it doesn't pick up items it passes over). **Fit to contents** (right-click the zone, or
  the right panel) resizes it around what it holds.

## Define Shape Data (Data tab)

- Like Visio's Define Shape Data: fields every device of the client gets — **Text**, **Number**, **Date**, **Pick list**
  (e.g. ISP: Spectrum, Verizon, Pilot Fiber) or **Yes / No** — for all devices or one category (e.g. only WAN devices).
  Quick-add ISP, Warranty expires, Firmware and Under contract.
- Each device's Shape Data shows these fields first, with a drop-down, date picker or number box. Values work like your
  own fields: info box, quick info, Reports columns, Excel, CSV, Word and `.vsdx`.
- Tick **Required** and Check Diagram lists every device where that field is empty. Renaming a field renames it on
  every device.

## Reports (Data → Reports)

- Like Visio's Report wizard: choose the devices (every page or one, a layer, and a condition such as "Serial is
  empty" or "Model contains TZ"), tick the fields — built-in ones and your own **My fields** — order the columns,
  sort, and add a totals row (device count, power, connections). The preview updates as you go.
- Export to **Excel (.xlsx)** with a bold frozen header and filters, **Word (.docx)**, **CSV**, or **Copy table** to
  paste into Excel, Word or an email. Report definitions are saved with the client.

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
- Drawn like Visio's rack diagrams: cabinet with top cap and base, equipment with mounting ears screwed to the
  rails, and leader lines from each item to its label.
- Front and rear views side by side. Items are **full depth** (both faces) or **front/rear only**, so a rear PDU can
  share a unit with a front blanking panel. Overlaps and out-of-rack positions are refused.
- Drag mounted items to move them; set U position, height and depth precisely in the right panel.
- A mounted device is the same device as on the diagram: name, model, IP, serial, **asset tag** and **power (W)** are
  shared, and the diagram's properties panel links to its rack position.
- The rack panel totals used/free units and power draw.
- Exports: the **PDF** gets a front/rear elevation page per rack and a **Rack contents** table; the **CSV** gets a
  RACKS section and rack positions in the device list.

## Visio drawings (.vsdx)

- **File → Save as Visio drawing** writes a `.vsdx` that opens in Microsoft Visio, one Visio page per page:
  - devices as pictures with their details as **Shape Data** (name, model, IP, MAC, serial, asset tag, location,
    status, your own fields, notes) and their ports as named **connection points** (glue new connectors in Visio);
  - cables as lines along the drawn route with their colour, dashes, arrows, label, and Shape Data (cable type,
    from, to, VLAN, length);
  - zones, notes, drawing shapes, dimension lines, device labels and info boxes as native Visio shapes and text.
- **File → Open** also opens Visio drawings (`.vsdx`): every page comes in; pictures and stencil shapes become
  devices (Shape Data such as *IP Address*, *Serial Number*, *Model* fill the device fields, the rest become your own
  fields; the shapes go into a library named after the file), plain boxes/ellipses/text become drawing shapes,
  transparent dashed boxes become zones, and connectors glued to shapes become cables on the nearest ports. A
  drawing saved by NetCraft comes back with its devices, fields, ports, cables, labels and info boxes.
- **Layers** (with visible / print / lock), **containers** (zones) and **background pages** go both ways: saved into
  the `.vsdx` and read back from Visio drawings.
- Lines in a Visio drawing that aren't glued between two shapes come in as drawn lines (or freehand shapes).
- Not carried over yet: Visio themes.

## Your own stencils (no code needed)

**+ Import image as device** (top of the shapes palette) takes an SVG, PNG, JPG or WebP — a vendor product photo, a datasheet
drawing, or a Visio shape exported as SVG (in Visio: select the shape → **File → Save As → SVG**). Then drag a box over
each port; every box becomes a connection point with a label, type (RJ45, SFP, console, power…), cable direction and
optional role (WAN, LAN, MGMT). Set how wide it should appear on the diagram and save.

- Hover a stencil in the palette to **✎ edit** its ports, library or **✕ delete** it.
- Imported stencils are organized into **libraries**, shown as folders under **My libraries** in the palette, apart
  from the built-in categories. Each Visio file becomes its own library; images go to **My stencils** unless you
  pick another library (or type a new one) in the stencil editor. Folders remember whether you left them open, and
  search looks inside every library.
- Hover a library folder to **✎ rename** it (renaming onto an existing name merges the two), **⤓ export** just that
  library, or **✕ delete** it (you're told how many devices in your diagrams use it).
- Library files (`.netcraft-stencils.json`) keep library names; **Import library** creates the library, or merges into
  one with the same name. **Export all** saves every library to one file.
- Saved project files embed the custom stencils they use, so a diagram opens correctly on any computer.
- Large photos are resized to 2000 px and re-encoded as WebP; SVGs containing scripts are refused.
- Stencils and diagrams are stored in the browser's IndexedDB (diagrams saved by v0.1 move over automatically).

Vendor artwork keeps its own license: import it for your own documentation, but don't bundle it in this repository.

### Visio stencils (.vssx)

**+ Import Visio stencil (.vssx)** opens a vendor stencil (Dell, Ubiquiti, HPE, Cisco…), lists its shapes with a live
preview, and imports the ones you tick into a library named after the file (e.g. `Dell-PowerEdge-RackServers-Classic.vssx`
→ "Dell PowerEdge Rack Servers Classic"). Change the name, or pick an existing library to add to it, before importing.

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
