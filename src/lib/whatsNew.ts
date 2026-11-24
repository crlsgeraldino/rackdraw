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
