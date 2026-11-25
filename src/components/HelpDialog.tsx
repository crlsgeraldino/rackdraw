'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { HELP_EVENT, SHORTCUTS_EVENT } from '@/lib/events';
import { getPref, setPref } from '@/lib/prefs';
import { APP_VERSION, notesSince, RELEASES, type ReleaseNotes } from '@/lib/whatsNew';
import { useDiagram } from '@/store/useDiagramStore';

/*
 * Help (F1, the ? button by the ribbon tabs, View → Shortcuts) and the What's new window shown once after an update.
 */

export type HelpSection = 'start' | 'home' | 'insert' | 'design' | 'data' | 'review' | 'view' | 'racks' | 'files' | 'shortcuts' | 'new' | 'about';

const SHORTCUTS: { title: string; keys: [string, string][] }[] = [
  { title: 'Files', keys: [['Ctrl+S', 'Save to the client\'s file (asks where the first time)'], ['Ctrl+Shift+S', 'Save As'], ['Ctrl+P', 'Print']] },
  { title: 'Tools', keys: [['Ctrl+1', 'Pointer'], ['Ctrl+2', 'Add a text box'], ['Ctrl+3', 'Connector'], ['Ctrl+4', 'Pencil'], ['Ctrl+6', 'Line'], ['Ctrl+8', 'Rectangle'], ['Ctrl+9', 'Ellipse'], ['Esc', 'Back to the pointer']] },
  { title: 'Edit', keys: [['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+C / X / V', 'Copy / Cut / Paste'], ['Ctrl+Shift+C / V', 'Copy / paste formatting'], ['Ctrl+D', 'Duplicate'], ['Del', 'Delete'], ['F2', 'Edit the text of the selected item'], ['Ctrl+A', 'Select all'], ['Ctrl+F / Ctrl+H', 'Find / Replace']] },
  { title: 'Arrange', keys: [['Arrow keys', 'Nudge one grid step'], ['Shift+Arrow', 'Nudge one pixel'], ['Ctrl+G / Ctrl+Shift+G', 'Group / Ungroup'], ['Ctrl+Shift+F', 'Bring to front'], ['Ctrl+Shift+B', 'Send to back'], ['Shift while dragging', 'Straight lines, square boxes']] },
  { title: 'View', keys: [['Ctrl+Shift+W', 'Fit the page'], ['Ctrl+scroll', 'Zoom'], ['Ctrl+Page Down / Up', 'Next / previous page'], ['F5', 'Full Screen (arrows change page, Esc ends)'], ['Ctrl+F1', 'Collapse the ribbon'], ['F1', 'Help']] },
];

const P = ({ children }: { children: ReactNode }) => <p className="mb-2 text-sm leading-relaxed text-gray-700">{children}</p>;
const H = ({ children }: { children: ReactNode }) => <h3 className="mb-1 mt-4 text-sm font-semibold text-gray-900 first:mt-0">{children}</h3>;
const L = ({ items }: { items: ReactNode[] }) => <ul className="mb-2 list-disc space-y-1 pl-5 text-sm text-gray-700">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
const K = ({ children }: { children: ReactNode }) => <b className="font-semibold text-gray-900">{children}</b>;

function Notes({ releases }: { releases: ReleaseNotes[] }) {
  return (
    <>
      {releases.map((r) => (
        <section key={r.version} className="mb-4">
          <h3 className="text-sm font-semibold text-gray-900">{r.title} <span className="font-normal text-gray-400">· {r.version}</span></h3>
          <L items={r.items} />
        </section>
      ))}
    </>
  );
}

const SECTIONS: { id: HelpSection; label: string; body: () => ReactNode }[] = [
  {
    id: 'start', label: 'Getting started', body: () => (
      <>
        <P>RackDraw documents your clients&apos; networks: diagrams, racks, floor plans, and the details behind them (IPs, ports, warranties, circuits, prices).</P>
        <H>Your first client</H>
        <L items={[
          <><K>File → New client</K>: start from a template (small, medium or large network, office, network types…) or a blank page.</>,
          <>Drag equipment from the <K>Shapes</K> window on the left onto the page. Search shapes by name, or filter by kind of network (LAN, WLAN, WAN…).</>,
          <>Connect two devices: drag from a port (or the edge of a device) to another one. Pick the cable type in <K>Shape Data</K> on the right.</>,
          <>Select anything to edit its details in <K>Shape Data</K>: name, IP, model, serial, ports, warranty, notes…</>,
          <>Mount equipment in racks with <K>View → Racks</K> (or <K>Data → Rack from Diagram</K>).</>,
        ]} />
        <H>Saving</H>
        <P>Everything is kept automatically on this computer as you work. <K>Ctrl+S</K> also saves the client to a <code>.rackdraw</code> file you can keep, email or open on another computer (see <K>Files and saving</K>).</P>
      </>
    ),
  },
  {
    id: 'home', label: 'Home tab', body: () => (
      <L items={[
        <><K>Clipboard</K>: paste, cut, copy, duplicate, and the Format Painter (copy one item&apos;s look onto others).</>,
        <><K>Tools</K>: pointer, lasso select, connector, text, line, rectangle, ellipse, pencil, dimension line and zone.</>,
        <><K>Font</K> and <K>Paragraph</K>: text of shapes, labels, cable text, zones and notes.</>,
        <><K>Shape Style</K>: fill, line, weight, quick styles and shadow.</>,
        <><K>Arrange</K>: align, distribute, same size, order, group, rotate, flip and lock.</>,
        <><K>Editing</K>: Find and Replace across the client, Select All.</>,
      ]} />
    ),
  },
  {
    id: 'insert', label: 'Insert tab', body: () => (
      <L items={[
        <><K>Pages</K>: new diagram pages and floor-plan pages (also from the + next to the page tabs at the bottom).</>,
        <><K>Pictures</K>: a picture or a PDF floor plan behind the page, images as devices, CAD drawings (DXF).</>,
        <><K>Shapes</K>: drawing shapes, zones, notes, callouts, tables, symbols, fields and hyperlinks.</>,
        <><K>Stencils</K>: import Visio stencils (.vssx) or pictures as your own shapes; they appear under My libraries in the Shapes window.</>,
      ]} />
    ),
  },
  {
    id: 'design', label: 'Design tab', body: () => (
      <L items={[
        <><K>Page Setup</K>: paper size and orientation (landscape / portrait) of each page, and units.</>,
        <><K>Drawing Scale</K>: real-world scale for floor plans, so lengths, wall lengths and room areas read in feet or metres.</>,
        <><K>Themes</K>, <K>Backgrounds</K>, <K>Borders &amp; Titles</K>, <K>Title Block</K>: the look of every page and printout.</>,
        <><K>Connectors</K>: line jumps where cables cross, and rounded corners.</>,
        <><K>Data Colours</K>: colour devices by status, location, model or warranty, and cables by type or VLAN, with a legend.</>,
        <><K>Cable Text</K>: what every cable shows (your label, its function, its type, or function + type) and the port names at both ends.</>,
        <><K>Info Boxes</K>: show or hide the details box on every device.</>,
      ]} />
    ),
  },
  {
    id: 'data', label: 'Data tab', body: () => (
      <L items={[
        <><K>Shape Data</K> and <K>Define Shape Data</K>: the details pane, and fields every device of this client has.</>,
        <><K>Device Table</K>: every device, cable and port as a spreadsheet under the drawing; type or paste from Excel.</>,
        <><K>External Data</K>: link a spreadsheet of devices (refresh it later), and <K>Network Scan</K> to bring in an nmap or IP-scanner export.</>,
        <><K>Layers</K> and <K>Data Graphics</K>: show or hide groups of items; small tags of device fields on every device.</>,
        <><K>Plan &amp; Quote</K>: <K>Sites</K> (the network place by place), <K>Wi-Fi Plan</K> (coverage map and how many access points a scaled floor plan needs), <K>IP Plan</K> (VLANs, subnets, next free IP), <K>Lifecycle</K> (warranties, end of life, circuits, replacement budget), <K>Bill of Materials</K> (what to order, labour and quote) and <K>Rack from Diagram</K>.</>,
        <><K>Reports</K>: device reports to Excel / Word / CSV, <K>Labels</K> (cable, asset and patch-panel labels with QR codes), <K>Port Map</K> (every port of a switch or panel, printed or to Excel), and <K>Switch Config</K> (a starting configuration from the documentation: VLANs, port descriptions, access / trunk ports, PoE; Cisco IOS, Aruba CX or a port table).</>,
      ]} />
    ),
  },
  {
    id: 'review', label: 'Review tab', body: () => (
      <L items={[
        <><K>Check Diagram</K>: finds duplicate IPs, IPs outside the IP plan, ports used twice, overloaded racks and UPSes, warranties ending and missing details. Click a finding to go to it.</>,
        <><K>Comments</K>: notes on items for your team, with replies.</>,
        <><K>Change Log</K>: what changed in this client and when (devices, IPs, ports, cables, racks, the IP plan), with notes of your own such as ticket numbers.</>,
      ]} />
    ),
  },
  {
    id: 'view', label: 'View tab', body: () => (
      <L items={[
        <><K>Views</K>: the diagram, the racks, Full Screen (F5) and this Help.</>,
        <><K>Zoom</K>: fit the page, zoom in and out, 100 %, zoom to the selection.</>,
        <><K>Show</K>: rulers, grid, page breaks, Pan &amp; Zoom, dynamic grid, snap, quick info on hover.</>,
        <><K>Task Panes</K>: Shapes, Shape Data and the Device Table.</>,
      ]} />
    ),
  },
  {
    id: 'racks', label: 'Racks', body: () => (
      <>
        <P>Open the racks with <K>View → Racks</K>; <K>← Diagram</K> goes back.</P>
        <L items={[
          <>Add a rack, then drag devices from the left (they are the same devices as on the diagram) and accessories (blanking panels, shelves, PDU, cable managers).</>,
          <>Front and rear views with patch cords drawn from the diagram&apos;s cables; hover a port to see what it connects to.</>,
          <>The panel on the right shows space used, power, heat and weight, the circuit and UPS load, and the patching list.</>,
          <><K>Build rack from diagram</K> mounts a page&apos;s rack equipment in a sensible order, one rack per location.</>,
        ]} />
      </>
    ),
  },
  {
    id: 'files', label: 'Files and saving', body: () => (
      <>
        <H>Automatic saving</H>
        <P>Every change is kept on this computer within a moment. Version History (File) keeps earlier copies of each client, and <K>File → Back up everything</K> puts all clients, stencils, templates and your price book in one file.</P>
        <H>Client files (.rackdraw)</H>
        <L items={[
          <><K>Save (Ctrl+S)</K>: the first time asks where; after that saves back to the same file. The title bar shows the file, with a dot while there are changes not saved to it.</>,
          <><K>Save As (Ctrl+Shift+S)</K>: a copy under a new name or place.</>,
          <><K>Open</K>: <code>.rackdraw</code> files, older <code>.rackdraw.json</code> files, Visio drawings (.vsdx) and templates (.vstx). Double-clicking a <code>.rackdraw</code> file in Explorer opens it too.</>,
          <><K>File → Recent</K> lists the client files you used lately; <K>Open file location</K> shows the file in Explorer.</>,
          <><K>File → Protect with password</K>: anyone opening the file needs the password (Ctrl+S keeps it protected). A forgotten password can&apos;t be recovered, so keep it in your password manager. The copy RackDraw keeps on this computer and exports are not protected. <K>Back up everything</K> can protect the backup too.</>,
        ]} />
        <H>Sharing</H>
        <P>Export from <K>File</K>: Visio drawing, PDF report, Word report, PowerPoint slides, pictures (PNG / SVG), a web page anyone can open, and CSV tables.</P>
      </>
    ),
  },
  {
    id: 'shortcuts', label: 'Keyboard shortcuts', body: () => (
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {SHORTCUTS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{g.title}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              {g.keys.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt><kbd className="whitespace-nowrap rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs text-gray-700">{k}</kbd></dt>
                  <dd className="text-gray-700">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    ),
  },
  { id: 'new', label: 'What\'s new', body: () => <Notes releases={RELEASES} /> },
  {
    id: 'about', label: 'About', body: () => (
      <>
        <P><K>RackDraw</K> {APP_VERSION && <>version {APP_VERSION}</>}</P>
        <P>Network, rack and floor-plan documentation for MSPs.</P>
        <P>Free and open source (MIT License). RackDraw uses open-source libraries such as React, React Flow, pdf.js and jsPDF: their licences are in <code>THIRD-PARTY-NOTICES.md</code>, installed next to RackDraw.exe (and published with the web version).</P>
        <P>Your clients are kept on this computer (in the app&apos;s data folder; the desktop app can use another folder through the <code>RACKDRAW_DATA_DIR</code> setting). Nothing is sent anywhere: RackDraw works without the internet.</P>
      </>
    ),
  },
];

/** Opens Help on F1 / the ? button (Getting started) and View → Shortcuts (Keyboard shortcuts). */
export function HelpHost() {
  const [open, setOpen] = useState<HelpSection | null>(null);
  useEffect(() => {
    const help = (e: Event) => setOpen(((e as CustomEvent<HelpSection | undefined>).detail) ?? 'start');
    const keys = () => setOpen('shortcuts');
    window.addEventListener(HELP_EVENT, help);
    window.addEventListener(SHORTCUTS_EVENT, keys);
    return () => { window.removeEventListener(HELP_EVENT, help); window.removeEventListener(SHORTCUTS_EVENT, keys); };
  }, []);
  return open ? <HelpDialog section={open} onSection={setOpen} onClose={() => setOpen(null)} /> : null;
}

function HelpDialog({ section, onSection, onClose }: { section: HelpSection; onSection: (s: HelpSection) => void; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const cur = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex h-[min(640px,90vh)] w-[min(900px,96vw)] overflow-hidden rounded-lg bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="Help">
        <nav className="w-48 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 py-2" aria-label="Help topics">
          <div className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Help</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id} type="button" onClick={() => onSection(s.id)} aria-current={s.id === cur.id ? 'page' : undefined}
              className={`block w-full px-3 py-1.5 text-left text-sm ${s.id === cur.id ? 'bg-blue-100 font-medium text-blue-900' : 'text-gray-700 hover:bg-gray-100'}`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center border-b border-gray-200 px-5 py-2.5">
            <h2 className="text-base font-semibold text-gray-900">{cur.label}</h2>
            <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{cur.body()}</div>
        </div>
      </div>
    </div>
  );
}

/** After an update: what's new since the version last used on this computer, once. */
export function WhatsNewHost() {
  const [notes, setNotes] = useState<ReleaseNotes[]>([]);
  useEffect(() => {
    const last = getPref('lastSeenVersion');
    // Someone with clients already was using RackDraw before this window existed: show them the last few releases.
    const s = useDiagram.getState();
    const existing = Object.keys(s.projects).length > 1 || Object.values(s.projects).some((p) => p.pages.some((pg) => pg.nodes.length > 0));
    const shown = notesSince(last, APP_VERSION, 6, existing);
    if (APP_VERSION) setPref('lastSeenVersion', APP_VERSION);
    if (shown.length) setNotes(shown);
  }, []);
  if (!notes.length) return null;
  const close = () => setNotes([]);
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="flex max-h-[85vh] w-[min(560px,94vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="What's new">
        <div className="flex items-center border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-semibold text-gray-900">What&apos;s new in RackDraw {APP_VERSION}</h2>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={close} aria-label="Close">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4"><Notes releases={notes} /></div>
        <div className="flex items-center border-t border-gray-200 px-5 py-2.5 text-xs text-gray-500">
          See it again any time in Help (F1) → What&apos;s new.
          <button className="ml-auto rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}
