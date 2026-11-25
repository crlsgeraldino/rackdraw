/*
 * What's new: short notes for recent releases, shown once after an update (and any time from Help).
 * Newest first. Each item is one line a user can act on: where it is and what it does.
 */

export interface ReleaseNotes {
  version: string;
  title: string;
  items: string[];
}

export const RELEASES: ReleaseNotes[] = [
  {
    version: '1.6.0',
    title: 'Quote only what the job supplies',
    items: [
      'Bill of Materials: mark each line New or Client has it (or how many the client has). Only new items are priced, and labor counts only them.',
      'Replacing a few things? Click Client has everything, then mark the switch, the firewall or the patch cords New. A new installation is Everything is new.',
      'The Word quote, Excel, CSV and the reports list what is already on site separately, not priced.',
    ],
  },
  {
    version: '1.5.3',
    title: 'Close a client your way',
    items: [
      'File → Close this client: a client saved in its own file just closes (the file stays, open it again from Recent). Unsaved changes can be saved first or left out.',
      'File → Delete this client: a client with no file can be deleted with a copy saved first, or without a copy.',
    ],
  },
  {
    version: '1.5.2',
    title: 'Racks: no more duplicate devices',
    items: [
      'Dragging a shape into a rack now mounts the device of that kind that is already on the diagram, instead of adding a second one. Drag it in again to add another.',
    ],
  },
  {
    version: '1.5.1',
    title: 'Up-to-date desktop engine',
    items: [
      'The desktop app runs on Electron 45.5 (the latest Chromium security fixes).',
      'On a small screen, ribbon menus that are taller than the window (like Borders & Titles) scroll instead of running off the bottom.',
      'RackDraw\'s home on GitHub is now github.com/crlsgeraldino/rackdraw (the old address still works).',
    ],
  },
  {
    version: '1.5.0',
    title: 'Borders, titles and outlines',
    items: [
      'Design → Borders & Titles has 12 designs (classic, title strip, corners, side band, footer band, tab, rounded, modern and more) with the page name, client, date and "Page n of m".',
      'The borders show on the page, in print and in the PDF report, where the page numbers count the report\'s pages. Switch the date or page number off in the same menu.',
      'Home → Line, Weight and the dash patterns now put an outline round devices; "No line" removes it. Zones take a line weight too.',
    ],
  },
  {
    version: '1.4.4',
    title: 'Ready to share',
    items: [
      'RackDraw is free and open source: Help → About lists the open-source libraries it uses, and their licences are installed next to RackDraw.exe (THIRD-PARTY-NOTICES.md).',
      'Shapes window: the library export button names the right file type (.rackdraw-stencils.json).',
    ],
  },
  {
    version: '1.4.3',
    title: 'Fewer surprises when editing',
    items: [
      'Select All, Delete, Cut and the arrow keys no longer reach items on hidden or locked layers.',
      'Deleting a device is one Undo step (the device comes back with its cables), and deleting a layer can be undone.',
      'Fit Page and "zoom to" from Find, Check Diagram, Comments and the Device Table leave a margin around the drawing again.',
      'Rack power counts PoE only on ports with a cable plugged in (and switched on). Prices like "1.200" or "€ 1.234" are read as thousands.',
      'Copied callouts point at the copied item, and a duplicated page keeps its callouts attached.',
      'Exports: line breaks in Shape Data reach Visio, CSV cells like "-48 VDC" open as text in Excel, and file names keep accents ("Café Río").',
      'Opening a file never replaces your own stencils; lengths like "1,5 m" and impossible dates are handled; rack items are whole units.',
    ],
  },
  {
    version: '1.4.2',
    title: 'Opens more files, never freezes on bad ones',
    items: [
      'Insert → CAD Drawing reads large floor plans (hundreds of thousands of lines) that used to fail, and a damaged DXF shows a message instead of freezing RackDraw.',
      'Link Data and Network Scan import read big sheets and scans quickly; a damaged Excel or nmap file no longer freezes the app.',
      'Visio stencils with damaged pictures inside, and pictures or PDFs with impossible sizes, are refused with a clear message instead of using up memory.',
      'A client file with damaged fields opens and works in Check Diagram, the IP plan, the bill of materials, port maps and labels.',
      'Escape now closes every dialog and panel, including Number Shapes, Define Shape Data, the Bill of Materials, Check Diagram and Comments.',
    ],
  },
  {
    version: '1.4.1',
    title: 'Your data, safer',
    items: [
      'Delete client saves the copy first and deletes only once it is saved: cancelling the copy keeps the client. A protected client\'s copy stays protected.',
      'Back up everything says whether the backup was really saved, and warns before putting password-protected clients into a backup without a password.',
      'In a browser, RackDraw open in a second tab no longer overwrites the first one\'s clients: "Use RackDraw here" moves it over safely.',
      'If your saved diagrams can\'t be read, starting empty never deletes them; diagrams saved by a newer RackDraw are left as they are.',
      'Version History problems are shown instead of silently losing versions. Password protection is remembered in a browser too, and "Forgot it?" saves a new copy with a new password.',
      'Files that can\'t be opened (too large, in use, offline) now say so, and a file with damaged items is opened without overwriting it on Save.',
    ],
  },
  {
    version: '1.4.0',
    title: 'Safer with files from anywhere',
    items: [
      'Files from other people are checked before they are used: colours, numbers, stencils and very large or deeply nested files can no longer break RackDraw or run anything inside it.',
      'The desktop app only runs its own code: nothing in an opened file can start a script, even in printouts and port maps.',
      'Save writes without asking only to files you opened or saved yourself. After this update the first Save of an older file may show the Save dialog once.',
      'Password-protected files with unusual protection settings are refused or re-saved with RackDraw\'s own.',
    ],
  },
  {
    version: '1.3.0',
    title: 'Password-protected files',
    items: [
      'File → Protect with password: anyone opening the client\'s .rackdraw file needs the password — from email, a shared folder or a USB stick. Saving keeps it protected; a lock shows next to the file name.',
      'File → Back up everything can protect the backup with a password too; Restore asks for it.',
      'A forgotten password can\'t be recovered: keep it in your password manager. The copy RackDraw keeps on this computer and exports (PDF, Visio, Word…) are not protected.',
    ],
  },
  {
    version: '1.2.1',
    title: 'Faster on big drawings',
    items: ['Pages with hundreds of cables re-draw much faster after a move: spacing parallel cables and line jumps now take a fraction of the time (several times faster at 500 cables, far more for big bundles of patch cords). The drawing is exactly the same.'],
  },
  {
    version: '1.2.0',
    title: 'Switch configuration starter',
    items: [
      'Data → Switch Config (also from a switch\'s Port Map): a starting configuration written from your documentation — VLANs with their names, port descriptions (where each port leads), access and trunk ports, PoE, ports turned off and the management address.',
      'Cisco IOS / IOS-XE, Aruba AOS-CX, or a port table for UniFi and other web-managed switches. Copy, save one, or save every switch at once. Review it before applying: RackDraw never connects to a switch and writes no passwords.',
    ],
  },
  {
    version: '1.1.0',
    title: 'Wi-Fi planning',
    items: [
      'Data → Wi-Fi Plan: on a floor plan with a drawing scale, a map of the estimated Wi-Fi signal from your access points, with walls taken into account.',
      'How much of the floor gets signal good enough for calls and video, and how many access points the floor needs (for coverage and for the number of people), with a button to place the suggested ones.',
      'Select a wall to set what it is made of (drywall, glass, brick, concrete…), and an access point to set its band and power.',
    ],
  },
  {
    version: '1.0.0',
    title: 'RackDraw 1.0',
    items: [
      'Help (F1 or the ? button next to the ribbon tabs): every ribbon tab explained, files and saving, keyboard shortcuts.',
      'This What\'s new window, after each update (and any time from Help).',
    ],
  },
  {
    version: '0.109.0',
    title: 'Client files',
    items: [
      'The title bar shows the client\'s file, with a dot while there are changes not saved to it.',
      'File → Recent lists the client files you opened or saved lately (also on the taskbar icon\'s right-click list), and File shows Open file location.',
    ],
  },
  {
    version: '0.108.0',
    title: 'RackDraw files (.rackdraw)',
    items: [
      'Save (Ctrl+S) writes a .rackdraw file: the first time it asks where, then it saves back to the same file. Save As (Ctrl+Shift+S) always asks.',
      'Double-click a .rackdraw file in Explorer to open it. Older .rackdraw.json files still open.',
    ],
  },
  {
    version: '0.107.0',
    title: 'Port names at cable ends',
    items: ['Design → Cable Text → Port names at the ends: each cable shows the port it plugs into at both ends.'],
  },
  {
    version: '0.106.0',
    title: 'Cable function and text',
    items: [
      'Every cable knows what it is for (WAN uplink, Uplink, Access, Patch, Backbone…), worked out from what it connects; change it in Shape Data → Function.',
      'Design → Cable Text shows the function, the cable type or both on every cable ("WAN uplink · Cat6").',
    ],
  },
  {
    version: '0.105.0',
    title: 'Replacement budget',
    items: ['Data → Lifecycle → Replacement budget: what is due for replacement each year for the next five years, and what it costs, from your price book.'],
  },
  {
    version: '0.104.0',
    title: 'Security',
    items: ['The desktop app loads nothing from the internet, grants only the permissions it needs, and refuses to start if its files were tampered with.'],
  },
  {
    version: '0.103.0',
    title: 'Sites',
    items: ['Data → Sites: the network place by place (HQ, branches, IDFs), with equipment, free switch ports, power, circuits and the links between sites.'],
  },
  {
    version: '0.102.0',
    title: 'Documentation pack',
    items: ['PDF, Word and printed reports include port maps and the last 90 days of changes; Shape Data shows each device\'s history.'],
  },
  {
    version: '0.101.0',
    title: 'Network scan import',
    items: ['Data → Network Scan: open an nmap or IP-scanner export; new hosts become devices and drawn devices are updated.'],
  },
  {
    version: '0.100.0',
    title: 'Change log',
    items: ['Review → Change Log: what changed in each client and when, with notes of your own (ticket numbers, site visits).'],
  },
];

/** -1, 0 or 1, comparing "1.2.10" and "1.10.0" as versions (not text). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0), pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The notes to show after an update from `lastSeen` to `current` (newest first, at most `max`). Nothing when the
 * version hasn't changed. With no version seen yet: a new user gets only the newest release; someone who already has
 * clients (updating from a version before this window existed) gets the last few.
 */
export function notesSince(lastSeen: string, current: string, max = 6, existingUser = false): ReleaseNotes[] {
  if (!current || (lastSeen && compareVersions(lastSeen, current) >= 0)) return [];
  const upTo = RELEASES.filter((r) => compareVersions(r.version, current) <= 0);
  if (!lastSeen) return upTo.slice(0, existingUser ? 4 : 1);
  return upTo.filter((r) => compareVersions(r.version, lastSeen) > 0).slice(0, max);
}

/** The running version (from package.json, put in at build time). */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '';
