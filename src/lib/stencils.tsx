import type { ReactNode } from 'react';
import type { NetworkScope, PortDef, StencilDef } from './types';

/* ------------------------------------------------------------------ */
/*  Stencil catalog                                                    */
/*  Panel stencils are drawn in native units; ports are listed with    */
/*  their native geometry so each one becomes a connection point.     */
/* ------------------------------------------------------------------ */

function rj(id: string, label: string, x: number, y: number, side: 'top' | 'bottom', extra: Partial<PortDef> = {}): PortDef {
  return { id, label, kind: 'rj45', x, y, w: 60, h: 54, side, flip: side === 'bottom', ...extra };
}

const sonicwallTz: StencilDef = {
  id: 'sonicwall-tz570-670',
  name: 'SonicWall TZ570 / TZ670',
  vendor: 'SonicWall',
  category: 'Firewalls',
  width: 1048,
  height: 172,
  scale: 0.5,
  style: 'panel',
  rackUnits: 1,
  defaults: { model: 'TZ570 / TZ670' },
  ports: [
    { id: 'CONSOLE', label: 'Console', kind: 'console', x: 304, y: 76, w: 68, h: 60, side: 'top' },
    { id: 'X8', label: 'X8', kind: 'sfp', x: 390, y: 18, w: 66, h: 58, side: 'top' },
    { id: 'X9', label: 'X9', kind: 'sfp', x: 390, y: 80, w: 66, h: 58, side: 'bottom' },
    rj('X6', 'X6', 483, 22, 'top'),
    rj('X4', 'X4', 552, 22, 'top'),
    rj('X2', 'X2', 621, 22, 'top', { role: 'WAN' }),
    rj('X0', 'X0', 690, 22, 'top', { role: 'LAN' }),
    rj('X7', 'X7', 483, 80, 'bottom'),
    rj('X5', 'X5', 552, 80, 'bottom'),
    rj('X3', 'X3', 621, 80, 'bottom'),
    rj('X1', 'X1', 690, 80, 'bottom', { role: 'WAN' }),
    { id: 'PSU2', label: 'PSU 2', kind: 'power', x: 803, y: 50, w: 34, h: 92, side: 'bottom' },
    { id: 'PSU1', label: 'PSU 1', kind: 'power', x: 862, y: 50, w: 34, h: 92, side: 'bottom' },
  ],
};

function switchStencil(id: string, name: string, copper: number, sfp: number, poe: boolean): StencilDef {
  const ports: PortDef[] = [];
  const cols = copper / 2;
  const startX = 150;
  const pitch = 42;
  const groupGap = 16;
  let lastX = startX;
  for (let c = 0; c < cols; c++) {
    const x = startX + c * pitch + Math.floor(c / 6) * groupGap;
    lastX = x;
    ports.push({ id: `P${c * 2 + 1}`, label: `${c * 2 + 1}`, kind: 'rj45', x, y: 14, w: 38, h: 34, side: 'top' });
    ports.push({ id: `P${c * 2 + 2}`, label: `${c * 2 + 2}`, kind: 'rj45', x, y: 52, w: 38, h: 34, side: 'bottom', flip: true });
  }
  const sfpStart = lastX + 70;
  for (let s = 0; s < sfp; s++) {
    const col = Math.floor(s / 2);
    const top = s % 2 === 0;
    ports.push({
      id: `SFP${s + 1}`, label: `SFP ${s + 1}`, kind: 'sfp',
      x: sfpStart + col * 52, y: top ? 14 : 52, w: 46, h: 34, side: top ? 'top' : 'bottom',
    });
  }
  const width = sfpStart + Math.ceil(sfp / 2) * 52 + 60;
  ports.push({ id: 'CONSOLE', label: 'Console', kind: 'console', x: 40, y: 30, w: 44, h: 40, side: 'top' });
  return {
    id, name, category: 'Switching', width, height: 100, scale: 0.5, style: 'panel', ports, rackUnits: 1,
    defaults: { model: `${copper}-port${poe ? ' PoE+' : ''} managed switch` },
  };
}

/**
 * Aggregation / core switch: `sfp` 10G SFP+ ports (X1, X2… odd on top, even below, like a copper switch) and `qsfp`
 * 40/100G QSFP uplinks (Q1…). The backbone of medium and large networks: IDF uplinks, servers, storage.
 */
function fiberSwitch(id: string, name: string, sfp: number, qsfp: number, model: string): StencilDef {
  const ports: PortDef[] = [];
  const startX = 150, pitch = 52, groupGap = 16;
  let lastX = startX;
  for (let c = 0; c < sfp / 2; c++) {
    const x = startX + c * pitch + Math.floor(c / 6) * groupGap;
    lastX = x;
    ports.push({ id: `X${c * 2 + 1}`, label: `${c * 2 + 1}`, kind: 'sfp', x, y: 14, w: 46, h: 34, side: 'top' });
    ports.push({ id: `X${c * 2 + 2}`, label: `${c * 2 + 2}`, kind: 'sfp', x, y: 52, w: 46, h: 34, side: 'bottom' });
  }
  const qStart = lastX + 80;
  for (let q = 0; q < qsfp; q++) {
    const top = q % 2 === 0;
    ports.push({ id: `Q${q + 1}`, label: `Q${q + 1}`, kind: 'sfp', x: qStart + Math.floor(q / 2) * 70, y: top ? 14 : 52, w: 62, h: 34, side: top ? 'top' : 'bottom' });
  }
  ports.push({ id: 'CONSOLE', label: 'Console', kind: 'console', x: 40, y: 30, w: 44, h: 40, side: 'top' });
  return {
    id, name, category: 'Switching', width: qStart + Math.ceil(qsfp / 2) * 70 + 60, height: 100, scale: 0.5, style: 'panel', ports, rackUnits: 1,
    defaults: { model },
  };
}

/** Patch panel: rows of 24 ports (1U each, like standard 24 / 48 / 96-port panels), numbered left to right, row by row. */
function patchPanel(count: number, fiber = false): StencilDef {
  const perRow = Math.min(24, count);
  const rows = Math.ceil(count / perRow);
  const ports: PortDef[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % perRow, r = Math.floor(i / perRow);
    const x = 90 + c * 36 + Math.floor(c / 6) * 14;
    ports.push({ id: `PP${i + 1}`, label: `${i + 1}`, kind: fiber ? 'sfp' : 'rj45', x, y: 34 + r * 90, w: 30, h: 28, side: 'bottom' });
  }
  return {
    id: fiber ? `patch-panel-fiber-${count}` : `patch-panel-${count}`, name: fiber ? `Fiber patch panel ${count}-port LC` : `Patch panel ${count}-port`, category: 'Switching',
    width: 90 + perRow * 36 + Math.floor(perRow / 6) * 14 + 60, height: 90 * rows, scale: 0.5, style: 'panel', ports, rackUnits: rows,
    defaults: { model: fiber ? `${count}-port LC duplex fiber panel, OM4 (${rows}U)` : `${count}-port Cat6 patch panel (${rows}U)` },
  };
}

function icon(id: string, name: string, category: StencilDef['category'], ports: { id: string; label: string; side: PortDef['side']; kind?: PortDef['kind'] }[], defaults?: StencilDef['defaults'], rackUnits?: number): StencilDef {
  const size = 64;
  const pos: Record<PortDef['side'], [number, number]> = { top: [size / 2, 0], bottom: [size / 2, size], left: [0, size / 2], right: [size, size / 2] };
  return {
    id, name, category, width: size, height: size, scale: 1, style: 'icon', defaults, rackUnits,
    ports: ports.map((p) => {
      const [cx, cy] = pos[p.side];
      return { id: p.id, label: p.label, kind: p.kind ?? 'link', x: cx - 5, y: cy - 5, w: 10, h: 10, side: p.side };
    }),
  };
}

export const STENCILS: StencilDef[] = [
  sonicwallTz,
  switchStencil('switch-24-poe', 'Switch 24-port PoE + 4 SFP', 24, 4, true),
  switchStencil('switch-48', 'Switch 48-port + 4 SFP', 48, 4, false),
  switchStencil('switch-48-poe', 'Switch 48-port PoE + 4 SFP+', 48, 4, true),
  switchStencil('switch-8', 'Switch 8-port + 2 SFP', 8, 2, false),
  fiberSwitch('switch-core-24sfp', 'Core / aggregation switch 24× SFP+ + 4× QSFP', 24, 4, '24× 10G SFP+, 4× 40/100G QSFP28 L3 switch'),
  patchPanel(24),
  patchPanel(48),
  patchPanel(96),
  patchPanel(24, true),
  icon('firewall', 'Firewall (1U)', 'Firewalls', [{ id: 'WAN', label: 'WAN', side: 'top', kind: 'rj45' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'sfp' }, { id: 'HA', label: 'HA / sync', side: 'right', kind: 'rj45' }, { id: 'MGMT', label: 'Management', side: 'left', kind: 'rj45' }], { model: 'Next-gen firewall' }, 1),
  icon('router', 'Router (1U)', 'WAN', [{ id: 'WAN', label: 'WAN 1', side: 'top', kind: 'rj45' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'rj45' }, { id: 'WAN2', label: 'WAN 2', side: 'right', kind: 'rj45' }], { model: 'Edge router' }, 1),
  icon('internet', 'Internet / ISP', 'WAN', [{ id: 'WAN', label: 'WAN', side: 'bottom' }]),
  icon('modem', 'ISP modem / ONT', 'WAN', [{ id: 'UPLINK', label: 'Uplink', side: 'top' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'rj45' }]),
  icon('access-point', 'Wireless access point', 'Wireless', [{ id: 'ETH', label: 'PoE uplink', side: 'top', kind: 'rj45' }, { id: 'WIFI', label: 'Wireless', side: 'bottom' }]),
  icon('server', 'Server', 'Servers', [{ id: 'NIC1', label: 'NIC 1', side: 'top', kind: 'rj45' }, { id: 'MGMT', label: 'iDRAC / iLO', side: 'left', kind: 'rj45' }, { id: 'NIC2', label: 'NIC 2', side: 'right', kind: 'rj45' }], undefined, 2),
  icon('nas', 'NAS', 'Servers', [{ id: 'NIC1', label: 'NIC 1', side: 'top', kind: 'rj45' }], undefined, 1),
  icon('san', 'SAN / storage array', 'Servers', [{ id: 'CTRL-A', label: 'Controller A', side: 'top', kind: 'sfp' }, { id: 'CTRL-B', label: 'Controller B', side: 'right', kind: 'sfp' }, { id: 'MGMT', label: 'Management', side: 'left', kind: 'rj45' }], { model: 'Dual-controller storage array' }, 2),
  icon('workstation', 'Workstation', 'Endpoints', [{ id: 'NIC', label: 'NIC', side: 'top', kind: 'rj45' }]),
  icon('laptop', 'Laptop', 'Endpoints', [{ id: 'NIC', label: 'NIC / Wi-Fi', side: 'top' }]),
  icon('printer', 'Printer / MFP', 'Endpoints', [{ id: 'NIC', label: 'NIC', side: 'top', kind: 'rj45' }]),
  icon('phone', 'VoIP phone', 'Endpoints', [{ id: 'LAN', label: 'LAN', side: 'top', kind: 'rj45' }, { id: 'PC', label: 'PC passthrough', side: 'bottom', kind: 'rj45' }]),
  icon('camera', 'IP camera', 'Endpoints', [{ id: 'ETH', label: 'PoE', side: 'top', kind: 'rj45' }]),
  icon('ups', 'UPS', 'Servers', [{ id: 'NMC', label: 'Network card', side: 'top', kind: 'rj45' }, { id: 'USB', label: 'USB', side: 'right', kind: 'usb' }], undefined, 2),
  // Switching (more sizes)
  switchStencil('switch-16-poe', 'Switch 16-port PoE + 2 SFP', 16, 2, true),
  switchStencil('switch-24', 'Switch 24-port + 4 SFP', 24, 4, false),
  // PAN: devices around one person
  icon('smartphone', 'Smartphone', 'Personal', [{ id: 'WIFI', label: 'Wi-Fi / cellular', side: 'top' }, { id: 'BT', label: 'Bluetooth', side: 'right' }, { id: 'USB', label: 'USB-C', side: 'bottom', kind: 'usb' }]),
  icon('tablet', 'Tablet', 'Personal', [{ id: 'WIFI', label: 'Wi-Fi', side: 'top' }, { id: 'BT', label: 'Bluetooth', side: 'right' }, { id: 'USB', label: 'USB-C', side: 'bottom', kind: 'usb' }]),
  icon('smartwatch', 'Smartwatch / wearable', 'Personal', [{ id: 'BT', label: 'Bluetooth', side: 'left' }]),
  icon('headset', 'Headset / earbuds', 'Personal', [{ id: 'BT', label: 'Bluetooth', side: 'left' }, { id: 'USB', label: 'USB', side: 'bottom', kind: 'usb' }]),
  icon('keyboard-mouse', 'Wireless keyboard / mouse', 'Personal', [{ id: 'BT', label: 'Bluetooth / 2.4 GHz', side: 'top' }]),
  icon('bt-adapter', 'Bluetooth / USB adapter', 'Personal', [{ id: 'BT', label: 'Bluetooth', side: 'left' }, { id: 'USB', label: 'USB', side: 'right', kind: 'usb' }]),
  icon('usb-hub', 'USB hub / dock', 'Personal', [{ id: 'HOST', label: 'Host', side: 'top', kind: 'usb' }, { id: 'U1', label: 'USB 1', side: 'left', kind: 'usb' }, { id: 'U2', label: 'USB 2', side: 'right', kind: 'usb' }, { id: 'ETH', label: 'Ethernet', side: 'bottom', kind: 'rj45' }]),
  icon('hotspot', 'Mobile hotspot', 'Personal', [{ id: 'CELL', label: 'Cellular', side: 'top' }, { id: 'WIFI', label: 'Wi-Fi', side: 'bottom' }]),
  // WLAN
  icon('ap-outdoor', 'Outdoor access point', 'Wireless', [{ id: 'ETH', label: 'PoE uplink', side: 'top', kind: 'rj45' }, { id: 'WIFI', label: 'Wireless', side: 'bottom' }], { model: 'Outdoor Wi-Fi 6 AP (IP67)' }),
  icon('mesh-node', 'Mesh Wi-Fi node', 'Wireless', [{ id: 'ETH', label: 'Ethernet', side: 'top', kind: 'rj45' }, { id: 'MESH', label: 'Mesh backhaul', side: 'right' }, { id: 'WIFI', label: 'Wireless', side: 'bottom' }]),
  icon('wifi-router', 'Wi-Fi router (SOHO)', 'Wireless', [{ id: 'WAN', label: 'WAN', side: 'top', kind: 'rj45' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'rj45' }, { id: 'WIFI', label: 'Wireless', side: 'right' }]),
  icon('range-extender', 'Wi-Fi range extender', 'Wireless', [{ id: 'WIFI', label: 'Wireless', side: 'left' }, { id: 'ETH', label: 'Ethernet', side: 'bottom', kind: 'rj45' }]),
  icon('wlc', 'Wireless LAN controller', 'Wireless', [{ id: 'UPLINK', label: 'Uplink', side: 'top', kind: 'sfp' }, { id: 'MGMT', label: 'Management', side: 'bottom', kind: 'rj45' }], { model: 'WLAN controller' }, 1),
  icon('wireless-bridge', 'Wireless bridge (point-to-point)', 'Wireless', [{ id: 'ETH', label: 'PoE / data', side: 'bottom', kind: 'rj45' }, { id: 'AIR', label: 'Radio link', side: 'right' }], { model: '5 / 60 GHz PtP bridge' }),
  icon('antenna', 'Antenna (sector / omni)', 'Wireless', [{ id: 'RF', label: 'RF', side: 'bottom' }, { id: 'AIR', label: 'Over the air', side: 'right' }]),
  // LAN infrastructure
  icon('kvm', 'KVM switch', 'Infrastructure', [{ id: 'NET', label: 'IP / network', side: 'top', kind: 'rj45' }, { id: 'CONSOLE', label: 'Console', side: 'bottom', kind: 'usb' }], { model: '8-port KVM over IP' }, 1),
  icon('console-server', 'Console server', 'Infrastructure', [{ id: 'NET', label: 'Network', side: 'top', kind: 'rj45' }, { id: 'SERIAL', label: 'Serial ports', side: 'bottom', kind: 'console' }, { id: 'CELL', label: 'LTE out-of-band', side: 'right' }], { model: '16-port console server' }, 1),
  icon('pdu-network', 'Switched PDU (metered)', 'Infrastructure', [{ id: 'NET', label: 'Network card', side: 'top', kind: 'rj45' }], { model: 'Switched, metered PDU' }, 1),
  icon('ip-pbx', 'IP PBX / voice gateway', 'Infrastructure', [{ id: 'ETH', label: 'LAN', side: 'top', kind: 'rj45' }, { id: 'TRUNK', label: 'SIP / PRI / FXO trunk', side: 'bottom' }], { model: 'IP PBX / SBC' }, 1),
  icon('load-balancer', 'Load balancer / ADC', 'Infrastructure', [{ id: 'VIP', label: 'Front end (VIP)', side: 'top', kind: 'sfp' }, { id: 'POOL', label: 'Server pool', side: 'bottom', kind: 'sfp' }, { id: 'MGMT', label: 'Management', side: 'left', kind: 'rj45' }], { model: 'Application delivery controller' }, 1),
  icon('tape-library', 'Tape library / backup appliance', 'Servers', [{ id: 'NIC1', label: 'NIC / FC', side: 'top', kind: 'sfp' }, { id: 'MGMT', label: 'Management', side: 'left', kind: 'rj45' }], undefined, 2),
  // Security
  icon('nvr', 'NVR (video recorder)', 'Security', [{ id: 'NIC1', label: 'Network', side: 'top', kind: 'rj45' }, { id: 'CAMS', label: 'Camera PoE ports', side: 'bottom', kind: 'rj45' }], { model: '16-channel NVR' }, 2),
  icon('access-control', 'Access control panel', 'Security', [{ id: 'ETH', label: 'Network', side: 'top', kind: 'rj45' }, { id: 'READER', label: 'Readers / locks', side: 'bottom' }]),
  icon('badge-reader', 'Badge / card reader', 'Security', [{ id: 'WIEGAND', label: 'Wiegand / OSDP', side: 'top' }]),
  icon('alarm-panel', 'Alarm / sensor panel', 'Security', [{ id: 'ETH', label: 'Network', side: 'top', kind: 'rj45' }, { id: 'CELL', label: 'Cellular backup', side: 'right' }]),
  // Endpoints
  icon('display', 'Display / smart TV', 'Endpoints', [{ id: 'ETH', label: 'Ethernet', side: 'top', kind: 'rj45' }, { id: 'WIFI', label: 'Wi-Fi', side: 'right' }]),
  icon('iot-device', 'IoT sensor / gateway', 'Endpoints', [{ id: 'ETH', label: 'Ethernet', side: 'top', kind: 'rj45' }, { id: 'RADIO', label: 'Zigbee / LoRa / BLE', side: 'right' }]),
  icon('pos-terminal', 'POS terminal', 'Endpoints', [{ id: 'ETH', label: 'Ethernet', side: 'top', kind: 'rj45' }, { id: 'USB', label: 'USB (scanner, drawer)', side: 'right', kind: 'usb' }]),
  icon('conference', 'Conference room system', 'Endpoints', [{ id: 'ETH', label: 'Ethernet', side: 'top', kind: 'rj45' }, { id: 'USB', label: 'USB camera / mic', side: 'right', kind: 'usb' }]),
  // Cabling parts
  icon('wall-jack', 'Wall jack / keystone faceplate', 'Cabling', [{ id: 'JACK', label: 'Jack', side: 'top', kind: 'rj45' }], { model: 'Cat6 keystone faceplate' }),
  icon('poe-injector', 'PoE injector', 'Cabling', [{ id: 'DATA', label: 'Data in', side: 'left', kind: 'rj45' }, { id: 'POE', label: 'PoE out', side: 'right', kind: 'rj45' }], { model: '802.3at PoE+ injector' }),
  icon('media-converter', 'Media converter (copper ↔ fiber)', 'Cabling', [{ id: 'RJ45', label: 'Copper', side: 'left', kind: 'rj45' }, { id: 'SFP', label: 'Fiber', side: 'right', kind: 'sfp' }]),
  icon('sfp-module', 'SFP / SFP+ transceiver', 'Cabling', [{ id: 'HOST', label: 'Switch port', side: 'left', kind: 'sfp' }, { id: 'LINE', label: 'Fiber / copper', side: 'right', kind: 'sfp' }], { model: '10GBASE-SR SFP+' }),
  icon('splice-closure', 'Fiber splice closure', 'Cabling', [{ id: 'F1', label: 'Trunk A', side: 'left' }, { id: 'F2', label: 'Trunk B', side: 'right' }], { model: 'Outdoor fiber splice closure' }),
  icon('optical-splitter', 'Optical splitter (PON)', 'Cabling', [{ id: 'IN', label: 'In (from OLT)', side: 'top' }, { id: 'OUT1', label: 'Out 1', side: 'bottom' }, { id: 'OUT2', label: 'Out 2', side: 'left' }, { id: 'OUT3', label: 'Out 3', side: 'right' }], { model: '1:8 PLC splitter' }),
  // MAN / carrier
  icon('metro-ntu', 'Metro Ethernet NTU / demarc', 'Carrier', [{ id: 'NETWORK', label: 'Carrier side', side: 'top', kind: 'sfp' }, { id: 'UNI', label: 'Customer (UNI)', side: 'bottom', kind: 'rj45' }], { model: 'Carrier Ethernet NTU' }, 1),
  icon('olt', 'GPON OLT', 'Carrier', [{ id: 'UPLINK', label: 'Uplink', side: 'top', kind: 'sfp' }, { id: 'PON', label: 'PON port', side: 'bottom', kind: 'sfp' }], { model: 'GPON / XGS-PON OLT' }, 1),
  icon('dwdm', 'DWDM / CWDM mux', 'Carrier', [{ id: 'LINE', label: 'Line fiber', side: 'top', kind: 'sfp' }, { id: 'CH1', label: 'Channel 1', side: 'bottom', kind: 'sfp' }, { id: 'CH2', label: 'Channel 2', side: 'right', kind: 'sfp' }, { id: 'CH3', label: 'Channel 3', side: 'left', kind: 'sfp' }], { model: '8-channel CWDM mux' }, 1),
  icon('microwave', 'Microwave radio link', 'Carrier', [{ id: 'IDU', label: 'Indoor unit / PoE', side: 'bottom', kind: 'rj45' }, { id: 'RF', label: 'Radio path', side: 'right' }], { model: 'Licensed microwave backhaul' }),
  icon('carrier-cloud', 'Metro / carrier network', 'Carrier', [{ id: 'A', label: 'Site A', side: 'top' }, { id: 'B', label: 'Site B', side: 'bottom' }, { id: 'C', label: 'Site C', side: 'left' }, { id: 'D', label: 'Site D', side: 'right' }]),
  icon('building', 'Building / site', 'Carrier', [{ id: 'N', label: 'North', side: 'top' }, { id: 'S', label: 'South', side: 'bottom' }, { id: 'W', label: 'West', side: 'left' }, { id: 'E', label: 'East', side: 'right' }]),
  // WAN
  icon('sdwan', 'SD-WAN edge', 'WAN', [{ id: 'WAN1', label: 'WAN 1', side: 'top', kind: 'rj45' }, { id: 'WAN2', label: 'WAN 2 / LTE', side: 'right', kind: 'rj45' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'rj45' }], { model: 'SD-WAN edge appliance' }, 1),
  icon('vpn-concentrator', 'VPN concentrator', 'WAN', [{ id: 'OUTSIDE', label: 'Outside', side: 'top', kind: 'rj45' }, { id: 'INSIDE', label: 'Inside', side: 'bottom', kind: 'rj45' }], { model: 'IPsec / SSL VPN gateway' }, 1),
  icon('wan-optimizer', 'WAN optimizer', 'WAN', [{ id: 'WAN', label: 'WAN', side: 'top', kind: 'rj45' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'rj45' }], undefined, 1),
  icon('lte-router', 'Cellular router (4G / 5G)', 'WAN', [{ id: 'CELL', label: 'Cellular', side: 'top' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'rj45' }, { id: 'WAN', label: 'Ethernet WAN', side: 'right', kind: 'rj45' }]),
  icon('satellite', 'Satellite terminal', 'WAN', [{ id: 'SKY', label: 'Satellite link', side: 'top' }, { id: 'LAN', label: 'LAN', side: 'bottom', kind: 'rj45' }]),
  icon('csu-dsu', 'CSU / DSU (T1 / E1)', 'WAN', [{ id: 'LINE', label: 'Telco line', side: 'top' }, { id: 'SERIAL', label: 'Serial / DTE', side: 'bottom', kind: 'console' }], undefined, 1),
  icon('mpls-cloud', 'MPLS / private WAN', 'WAN', [{ id: 'A', label: 'Site A', side: 'top' }, { id: 'B', label: 'Site B', side: 'bottom' }, { id: 'C', label: 'Site C', side: 'left' }, { id: 'D', label: 'Site D', side: 'right' }]),
  icon('cloud-service', 'Cloud (IaaS / SaaS)', 'WAN', [{ id: 'NET', label: 'Internet / ExpressRoute', side: 'bottom' }, { id: 'VPN', label: 'Site-to-site VPN', side: 'left' }]),
  icon('remote-user', 'Remote user (VPN client)', 'WAN', [{ id: 'VPN', label: 'VPN / Internet', side: 'top' }]),
];

/** Which kinds of network each built-in stencil is used in (Shapes window → PAN / WLAN / LAN / CAN / MAN / WAN). */
const NETWORKS: Record<string, NetworkScope[]> = {
  'sonicwall-tz570-670': ['LAN', 'CAN', 'WAN'], firewall: ['LAN', 'CAN', 'WAN'], router: ['WAN', 'MAN', 'LAN'],
  'switch-24-poe': ['LAN', 'CAN', 'WLAN'], 'switch-48': ['LAN', 'CAN'], 'switch-48-poe': ['LAN', 'CAN', 'WLAN'], 'switch-8': ['LAN'], 'switch-16-poe': ['LAN', 'WLAN'], 'switch-24': ['LAN', 'CAN'],
  'switch-core-24sfp': ['LAN', 'CAN', 'MAN'], 'patch-panel-24': ['LAN', 'CAN'], 'patch-panel-48': ['LAN', 'CAN'], 'patch-panel-96': ['LAN', 'CAN'], 'patch-panel-fiber-24': ['LAN', 'CAN', 'MAN'],
  internet: ['WAN', 'MAN'], modem: ['WAN', 'MAN'], 'access-point': ['WLAN', 'LAN'], server: ['LAN'], nas: ['LAN'], san: ['LAN'],
  workstation: ['LAN'], laptop: ['LAN', 'WLAN', 'PAN'], printer: ['LAN', 'WLAN'], phone: ['LAN'], camera: ['LAN', 'WLAN'], ups: ['LAN'],
  smartphone: ['PAN', 'WLAN', 'WAN'], tablet: ['PAN', 'WLAN'], smartwatch: ['PAN'], headset: ['PAN'], 'keyboard-mouse': ['PAN'], 'bt-adapter': ['PAN'], 'usb-hub': ['PAN', 'LAN'], hotspot: ['PAN', 'WLAN', 'WAN'],
  'ap-outdoor': ['WLAN', 'CAN'], 'mesh-node': ['WLAN'], 'wifi-router': ['WLAN', 'LAN', 'WAN'], 'range-extender': ['WLAN'], wlc: ['WLAN', 'LAN', 'CAN'], 'wireless-bridge': ['WLAN', 'CAN', 'MAN'], antenna: ['WLAN', 'CAN', 'MAN'],
  kvm: ['LAN'], 'console-server': ['LAN', 'WAN'], 'pdu-network': ['LAN'], 'ip-pbx': ['LAN', 'WAN'], 'load-balancer': ['LAN', 'WAN'], 'tape-library': ['LAN'],
  nvr: ['LAN'], 'access-control': ['LAN', 'CAN'], 'badge-reader': ['LAN', 'CAN'], 'alarm-panel': ['LAN', 'WAN'],
  display: ['LAN', 'WLAN'], 'iot-device': ['LAN', 'WLAN', 'PAN'], 'pos-terminal': ['LAN'], conference: ['LAN', 'WLAN'],
  'wall-jack': ['LAN', 'CAN'], 'poe-injector': ['LAN', 'WLAN'], 'media-converter': ['LAN', 'CAN', 'MAN'], 'sfp-module': ['LAN', 'CAN', 'MAN'], 'splice-closure': ['CAN', 'MAN'], 'optical-splitter': ['CAN', 'MAN'],
  'metro-ntu': ['MAN', 'WAN'], olt: ['MAN', 'CAN'], dwdm: ['MAN'], microwave: ['MAN', 'CAN', 'WAN'], 'carrier-cloud': ['MAN', 'WAN'], building: ['CAN', 'MAN', 'WAN'],
  sdwan: ['WAN'], 'vpn-concentrator': ['WAN'], 'wan-optimizer': ['WAN'], 'lte-router': ['WAN'], satellite: ['WAN'], 'csu-dsu': ['WAN'], 'mpls-cloud': ['WAN', 'MAN'], 'cloud-service': ['WAN'], 'remote-user': ['WAN', 'PAN'],
};
for (const s of STENCILS) s.networks = NETWORKS[s.id];

export const STENCIL_MAP: Record<string, StencilDef> = Object.fromEntries(STENCILS.map((s) => [s.id, s]));

/* ------------------------------------------------------------------ */
/*  Artwork                                                            */
/* ------------------------------------------------------------------ */

export type PortState = 'idle' | 'connected' | 'selected';

const PORT_STROKE: Record<PortState, string | undefined> = {
  idle: undefined,
  connected: '#22c55e',
  selected: '#3b82f6',
};

export function PortArt({ port, state }: { port: PortDef; state: PortState }) {
  const { x, y, w, h } = port;
  const stroke = PORT_STROKE[state];
  const ring = stroke ? <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} fill="none" stroke={stroke} strokeWidth={4} rx={3} /> : null;

  if (port.kind === 'rj45' || port.kind === 'console') {
    const m = Math.max(4, w * 0.1);
    const notchW = w * 0.34;
    const notchH = h * 0.1;
    const top = y + h * 0.12;
    const bottom = y + h * 0.82;
    const nx = x + (w - notchW) / 2;
    const d = port.flip
      ? `M${x + m} ${top} H${x + w - m} V${bottom} H${nx + notchW} V${bottom + notchH} H${nx} V${bottom} H${x + m} Z`
      : `M${x + m} ${top + notchH} H${nx} V${top} H${nx + notchW} V${top + notchH} H${x + w - m} V${bottom} H${x + m} Z`;
    const pinY = port.flip ? top + 3 : bottom - 5;
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={port.kind === 'console' ? '#d4d4d4' : '#bfbfbf'} />
        <path d={d} fill="#161616" />
        <rect x={x + m * 2} y={pinY} width={w - m * 4} height={2} fill="#a38b3c" />
        {state === 'connected' && <rect x={x + w - m - 6} y={port.flip ? y + h - 7 : y + 2} width={6} height={4} fill="#22c55e" />}
        {ring}
      </g>
    );
  }
  if (port.kind === 'sfp') {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill="#c9c9c9" />
        <rect x={x + w * 0.09} y={y + h * 0.14} width={w * 0.82} height={h * 0.72} fill="#151515" />
        <rect x={x + w * 0.3} y={y + h * 0.05} width={w * 0.4} height={h * 0.07} rx={1} fill="#8f8f8f" />
        {state === 'connected' && <rect x={x + w * 0.2} y={y + h * 0.3} width={w * 0.6} height={h * 0.4} fill="#3a3a3a" stroke="#ea580c" strokeWidth={2} />}
        {ring}
      </g>
    );
  }
  if (port.kind === 'power') {
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} rx={2} fill="#141414" stroke="#5a5a5a" />
        <rect x={x + 6} y={y + 22} width={w - 12} height={48} fill="#202020" stroke="#6a6a6a" />
        <circle cx={x + w / 2} cy={y + 36} r={3} fill="#cfcfcf" />
        <circle cx={x + w / 2} cy={y + 56} r={3} fill="#cfcfcf" />
        {ring}
      </g>
    );
  }
  return null;
}

function SonicWallDecor() {
  return (
    <g fontFamily="Arial, Helvetica, sans-serif">
      <path d="M300 64 H294 V156 H300" fill="none" stroke="#bdbdbd" strokeWidth={1.5} />
      <text x={338} y={58} fontSize={9} fill="#e0e0e0" textAnchor="middle">CONSOLE</text>
      <rect x={320} y={143} width={36} height={10} rx={5} fill="#111" stroke="#8c8c8c" />
      <rect x={478} y={18} width={278} height={120} fill="#d0d0d0" />
      <g fontSize={9} fill="#e0e0e0" textAnchor="middle">
        <text x={423} y={151}>X8</text><text x={423} y={161}>X9</text>
        <text x={513} y={151}>X6</text><text x={513} y={161}>X7</text>
        <text x={582} y={151}>X4</text><text x={582} y={161}>X5</text>
        <text x={651} y={151}>X2/WAN</text><text x={651} y={161}>X3</text>
        <text x={720} y={151}>X0/LAN</text><text x={720} y={161}>X1/WAN</text>
        <text x={820} y={42}>⏻2</text><text x={879} y={42}>⏻1</text>
        <text x={820} y={155} fontSize={8}>12V ⎓</text><text x={879} y={155} fontSize={8}>12V ⎓</text>
      </g>
      <g fontSize={7} fill="#bdbdbd">
        <text x={760} y={150}>• TOP</text>
        <text x={760} y={160}>• BOTTOM</text>
      </g>
      <circle cx={920} cy={120} r={3} fill="#0d0d0d" stroke="#555" />
      <circle cx={970} cy={142} r={11} fill="#3a3a3a" stroke="#777" />
      <path d="M963 142 H977 M970 135 V149" stroke="#999" strokeWidth={2} />
      <circle cx={995} cy={142} r={7} fill="none" stroke="#cfcfcf" strokeWidth={1.2} />
      <path d="M995 137 V142 M991 142 H999 M992.5 144.5 H997.5 M994 147 H996" stroke="#cfcfcf" strokeWidth={1.1} />
      <text x={40} y={100} fontSize={22} fill="#8d8d90" fontWeight={700} letterSpacing={3}>TZ</text>
    </g>
  );
}

function SwitchDecor({ s }: { s: StencilDef }) {
  const leds = s.ports.filter((p) => p.kind === 'rj45' && p.side === 'top').length;
  return (
    <g fontFamily="Arial, Helvetica, sans-serif">
      <circle cx={110} cy={30} r={4} fill="#22c55e" />
      <text x={110} y={48} fontSize={8} fill="#cfcfcf" textAnchor="middle">PWR</text>
      <text x={40} y={90} fontSize={9} fill="#cfcfcf">CONSOLE</text>
      <text x={s.width - 20} y={92} fontSize={9} fill="#9a9a9a" textAnchor="end">{leds * 2 > 0 ? `${leds * 2}P` : ''}</text>
      {s.ports.filter((p) => p.kind === 'rj45' || (p.kind === 'sfp' && s.id.startsWith('switch-core'))).map((p) => (
        <text key={p.id} x={p.x + p.w / 2} y={p.side === 'top' ? p.y - 2 : p.y + p.h + 9} fontSize={7} fill="#cfcfcf" textAnchor="middle">{p.label}</text>
      ))}
      {s.id.startsWith('switch-core') && <text x={110} y={80} fontSize={9} fill="#7dd3fc" textAnchor="middle">L3</text>}
    </g>
  );
}

function PatchDecor({ s }: { s: StencilDef }) {
  const rows = Math.max(1, Math.round(s.height / 90));
  return (
    <g fontFamily="Arial, Helvetica, sans-serif">
      {Array.from({ length: rows }, (_, r) => (
        <g key={r}>
          {/* Each 1U row: its write-on label strip, mounting holes, and a seam to the next row. */}
          <rect x={70} y={10 + r * 90} width={s.width - 120} height={18} fill="#f5f5f5" />
          <circle cx={30} cy={45 + r * 90} r={7} fill="#111" stroke="#666" />
          <circle cx={s.width - 30} cy={45 + r * 90} r={7} fill="#111" stroke="#666" />
          {r > 0 && <rect x={0} y={r * 90 - 1} width={s.width} height={2} fill="#1c1c1e" />}
        </g>
      ))}
      {s.ports.map((p) => (
        <text key={p.id} x={p.x + p.w / 2} y={p.y - 10} fontSize={9} fill="#333" textAnchor="middle">{p.label}</text>
      ))}
    </g>
  );
}

/** A fiber panel's LC duplex adapters (aqua, OM4), drawn over its ports. */
function FiberAdapters({ s }: { s: StencilDef }) {
  return (
    <g pointerEvents="none">
      {s.ports.map((p) => (
        <g key={p.id}>
          <rect x={p.x + 3} y={p.y + 5} width={p.w / 2 - 4} height={p.h - 10} rx={1.5} fill="#22d3ee" opacity={0.85} />
          <rect x={p.x + p.w / 2 + 1} y={p.y + 5} width={p.w / 2 - 4} height={p.h - 10} rx={1.5} fill="#22d3ee" opacity={0.85} />
        </g>
      ))}
    </g>
  );
}

/** Front-panel artwork. `width`/`height` override the diagram size (the rack view draws it to fit a slot). */
export function PanelArt({ stencil, portStates, width, height }: { stencil: StencilDef; portStates: Record<string, PortState>; width?: number; height?: number }) {
  const decor: ReactNode =
    stencil.id === sonicwallTz.id ? <SonicWallDecor /> :
    stencil.id.startsWith('patch') ? <PatchDecor s={stencil} /> :
    <SwitchDecor s={stencil} />;
  const chassis = stencil.id.startsWith('patch') ? '#3b3b3e' : '#2a2a2c';
  return (
    <svg viewBox={`0 0 ${stencil.width} ${stencil.height}`} width={width ?? stencil.width * stencil.scale} height={height ?? stencil.height * stencil.scale} style={{ display: 'block' }}>
      <rect x={0} y={0} width={stencil.width} height={stencil.height} rx={3} fill={chassis} />
      <rect x={0} y={0} width={stencil.width} height={6} rx={2} fill="#4a4a4d" />
      <rect x={0} y={stencil.height - 6} width={stencil.width} height={6} rx={2} fill="#1c1c1e" />
      {decor}
      {stencil.ports.map((p) => <PortArt key={p.id} port={p} state={portStates[p.id] ?? 'idle'} />)}
      {stencil.id.startsWith('patch-panel-fiber') && <FiberAdapters s={stencil} />}
    </svg>
  );
}

/** Simple line-art symbols, 64×64. */
export function IconArt({ id, size = 64 }: { id: string; size?: number }) {
  const s = { fill: 'none', stroke: '#1f2937', strokeWidth: 2.5, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  const accent = '#2563eb';
  let body: ReactNode;
  switch (id) {
    case 'internet':
      body = <path {...s} fill="#dbeafe" stroke={accent} d="M18 46 a12 12 0 0 1 0-24 a16 16 0 0 1 30-4 a12 12 0 0 1 2 28 Z" />;
      break;
    case 'modem':
      body = (<g {...s}><rect x={10} y={26} width={44} height={20} rx={4} fill="#f3f4f6" /><circle cx={20} cy={36} r={2} fill="#22c55e" stroke="none" /><circle cx={28} cy={36} r={2} fill="#22c55e" stroke="none" /><path d="M42 26 V14 M48 26 V18" /></g>);
      break;
    case 'access-point':
      body = (<g {...s}><ellipse cx={32} cy={36} rx={22} ry={9} fill="#f3f4f6" /><circle cx={32} cy={36} r={2.5} fill={accent} stroke="none" /><path stroke={accent} d="M22 20 a14 14 0 0 1 20 0 M26 25 a8 8 0 0 1 12 0" /></g>);
      break;
    case 'server':
      body = (<g {...s}><rect x={14} y={10} width={36} height={14} rx={2} fill="#f3f4f6" /><rect x={14} y={25} width={36} height={14} rx={2} fill="#f3f4f6" /><rect x={14} y={40} width={36} height={14} rx={2} fill="#f3f4f6" /><path d="M20 17 H32 M20 32 H32 M20 47 H32" /><circle cx={44} cy={17} r={1.5} fill="#22c55e" stroke="none" /><circle cx={44} cy={32} r={1.5} fill="#22c55e" stroke="none" /><circle cx={44} cy={47} r={1.5} fill="#22c55e" stroke="none" /></g>);
      break;
    case 'nas':
      body = (<g {...s}><rect x={16} y={10} width={32} height={44} rx={3} fill="#f3f4f6" /><path d="M22 20 H42 M22 28 H42 M22 36 H42 M22 44 H42" /></g>);
      break;
    case 'workstation':
      body = (<g {...s}><rect x={10} y={12} width={44} height={30} rx={2} fill="#f3f4f6" /><path d="M26 42 V50 M38 42 V50 M20 52 H44" /></g>);
      break;
    case 'laptop':
      body = (<g {...s}><rect x={14} y={16} width={36} height={24} rx={2} fill="#f3f4f6" /><path d="M8 46 H56 L52 40 H12 Z" fill="#e5e7eb" /></g>);
      break;
    case 'printer':
      body = (<g {...s}><rect x={20} y={10} width={24} height={14} fill="#fff" /><rect x={10} y={24} width={44} height={20} rx={3} fill="#f3f4f6" /><rect x={20} y={38} width={24} height={16} fill="#fff" /></g>);
      break;
    case 'phone':
      body = (<g {...s}><rect x={14} y={22} width={36} height={28} rx={3} fill="#f3f4f6" /><path d="M10 22 q22 -14 44 0 l-4 6 q-18 -8 -36 0 Z" fill="#e5e7eb" /><path d="M22 34 H42 M22 41 H42" /></g>);
      break;
    case 'camera':
      body = (<g {...s}><rect x={10} y={22} width={34} height={18} rx={4} fill="#f3f4f6" /><path d="M44 27 L54 22 V40 L44 35" fill="#e5e7eb" /><path d="M20 40 V50 M14 50 H28" /><circle cx={18} cy={31} r={3} fill={accent} stroke="none" /></g>);
      break;
    case 'firewall':
      body = (<g {...s}><rect x={8} y={14} width={48} height={36} rx={2} fill="#fee2e2" stroke="#b91c1c" /><path stroke="#b91c1c" d="M8 26 H56 M8 38 H56 M20 14 V26 M38 14 V26 M28 26 V38 M46 26 V38 M18 38 V50 M38 38 V50" /></g>);
      break;
    case 'router':
      body = (<g {...s}><ellipse cx={32} cy={36} rx={24} ry={12} fill="#f3f4f6" /><path d="M8 36 V28 M56 36 V28" /><ellipse cx={32} cy={28} rx={24} ry={12} fill="#f3f4f6" /><path stroke={accent} d="M22 24 L28 28 M22 24 L22 29 M42 32 L36 28 M42 32 L42 27 M24 33 H40 M36 22 L42 24 L36 26" /></g>);
      break;
    case 'san':
      body = (<g {...s}><rect x={10} y={12} width={44} height={18} rx={2} fill="#f3f4f6" /><rect x={10} y={34} width={44} height={18} rx={2} fill="#f3f4f6" /><path d="M16 17 V25 M22 17 V25 M28 17 V25 M34 17 V25 M16 39 V47 M22 39 V47 M28 39 V47 M34 39 V47" /><circle cx={47} cy={21} r={2} fill="#22c55e" stroke="none" /><circle cx={47} cy={43} r={2} fill="#22c55e" stroke="none" /></g>);
      break;
    case 'smartphone':
      body = (<g {...s}><rect x={20} y={6} width={24} height={52} rx={5} fill="#f3f4f6" /><path d="M28 12 H36" /><circle cx={32} cy={51} r={2.5} fill="#1f2937" stroke="none" /><path stroke={accent} d="M30 26 l4 4 l-4 4 V22 l4 4 l-4 4" /></g>);
      break;
    case 'tablet':
      body = (<g {...s}><rect x={10} y={8} width={44} height={50} rx={5} fill="#f3f4f6" /><rect x={15} y={13} width={34} height={38} rx={1} fill="#dbeafe" stroke={accent} /><circle cx={32} cy={54} r={1.8} fill="#1f2937" stroke="none" /></g>);
      break;
    case 'smartwatch':
      body = (<g {...s}><path d="M24 6 H40 L38 16 H26 Z M26 48 H38 L40 58 H24 Z" fill="#e5e7eb" /><rect x={18} y={16} width={28} height={32} rx={7} fill="#f3f4f6" /><path stroke={accent} d="M32 24 V32 L38 36" /></g>);
      break;
    case 'headset':
      body = (<g {...s}><path d="M14 38 V32 a18 18 0 0 1 36 0 V38" fill="none" /><rect x={8} y={34} width={12} height={18} rx={4} fill="#f3f4f6" /><rect x={44} y={34} width={12} height={18} rx={4} fill="#f3f4f6" /><path stroke={accent} d="M20 50 q8 8 16 4" /></g>);
      break;
    case 'keyboard-mouse':
      body = (<g {...s}><rect x={4} y={28} width={40} height={18} rx={3} fill="#f3f4f6" /><path d="M10 34 H38 M10 40 H38" strokeWidth={1.5} /><rect x={48} y={26} width={12} height={20} rx={6} fill="#f3f4f6" /><path d="M54 26 V33" /><path stroke={accent} d="M22 12 a10 10 0 0 1 14 0 M25 17 a5 5 0 0 1 8 0" /></g>);
      break;
    case 'bt-adapter':
      body = (<g {...s}><rect x={8} y={24} width={34} height={16} rx={4} fill="#f3f4f6" /><rect x={42} y={27} width={14} height={10} fill="#e5e7eb" /><path stroke={accent} d="M20 26 l6 6 l-6 6 V26 M20 32 l6 -6" /></g>);
      break;
    case 'usb-hub':
      body = (<g {...s}><rect x={10} y={22} width={44} height={22} rx={5} fill="#f3f4f6" /><rect x={16} y={29} width={8} height={6} fill="#1f2937" stroke="none" /><rect x={28} y={29} width={8} height={6} fill="#1f2937" stroke="none" /><rect x={40} y={29} width={8} height={6} fill="#1f2937" stroke="none" /><path d="M32 22 V12" /></g>);
      break;
    case 'hotspot':
      body = (<g {...s}><rect x={14} y={24} width={36} height={24} rx={6} fill="#f3f4f6" /><path d="M20 42 H26 M28 42 H34" /><path stroke={accent} d="M24 16 a12 12 0 0 1 16 0 M28 20 a6 6 0 0 1 8 0" /></g>);
      break;
    case 'ap-outdoor':
      body = (<g {...s}><rect x={20} y={12} width={24} height={34} rx={4} fill="#f3f4f6" /><path d="M26 6 V12 M38 6 V12 M24 52 H40 M32 46 V52" /><circle cx={32} cy={28} r={3} fill={accent} stroke="none" /><path stroke={accent} d="M10 22 a16 16 0 0 0 0 14 M54 22 a16 16 0 0 1 0 14" /></g>);
      break;
    case 'mesh-node':
      body = (<g {...s}><path d="M18 52 V24 a14 14 0 0 1 28 0 V52 Z" fill="#f3f4f6" /><circle cx={32} cy={30} r={2.5} fill={accent} stroke="none" /><path stroke={accent} d="M8 18 l6 4 M56 18 l-6 4 M8 44 l6 -4 M56 44 l-6 -4" /></g>);
      break;
    case 'wifi-router':
      body = (<g {...s}><rect x={8} y={34} width={48} height={16} rx={4} fill="#f3f4f6" /><path d="M18 34 L14 14 M46 34 L50 14" /><circle cx={16} cy={42} r={1.8} fill="#22c55e" stroke="none" /><circle cx={23} cy={42} r={1.8} fill="#22c55e" stroke="none" /><path stroke={accent} d="M26 22 a8 8 0 0 1 12 0 M29 26 a4 4 0 0 1 6 0" /></g>);
      break;
    case 'range-extender':
      body = (<g {...s}><rect x={18} y={14} width={28} height={36} rx={6} fill="#f3f4f6" /><path d="M26 50 V56 M38 50 V56" /><path stroke={accent} d="M25 30 a10 10 0 0 1 14 0 M28 35 a5 5 0 0 1 8 0" /></g>);
      break;
    case 'wlc':
      body = (<g {...s}><rect x={6} y={24} width={52} height={18} rx={2} fill="#f3f4f6" /><circle cx={14} cy={33} r={2} fill="#22c55e" stroke="none" /><path stroke={accent} d="M24 16 a12 12 0 0 1 16 0 M28 20 a6 6 0 0 1 8 0 M22 33 H50" /></g>);
      break;
    case 'wireless-bridge':
      body = (<g {...s}><ellipse cx={22} cy={32} rx={8} ry={16} fill="#f3f4f6" /><path d="M22 48 V56 M16 56 H28" /><path stroke={accent} d="M36 26 a10 10 0 0 1 0 12 M42 22 a16 16 0 0 1 0 20 M48 18 a22 22 0 0 1 0 28" /></g>);
      break;
    case 'antenna':
      body = (<g {...s}><path d="M32 22 V56 M24 56 H40 M32 22 L22 6 M32 22 L42 6 M26 14 H38" /><path stroke={accent} d="M44 20 a12 12 0 0 1 0 14 M50 16 a18 18 0 0 1 0 22" /></g>);
      break;
    case 'kvm':
      body = (<g {...s}><rect x={6} y={26} width={52} height={14} rx={2} fill="#f3f4f6" /><path d="M12 33 H24" /><rect x={20} y={8} width={24} height={14} rx={1} fill="#dbeafe" stroke={accent} /><path d="M28 46 H36 M24 52 H40" /></g>);
      break;
    case 'console-server':
      body = (<g {...s}><rect x={6} y={24} width={52} height={18} rx={2} fill="#f3f4f6" /><path d="M12 30 H18 M21 30 H27 M30 30 H36 M39 30 H45 M12 36 H18 M21 36 H27 M30 36 H36 M39 36 H45" strokeWidth={2} /><path stroke={accent} d="M14 14 l6 4 l-6 4 M24 22 H32" /></g>);
      break;
    case 'pdu-network':
      body = (<g {...s}><rect x={6} y={24} width={52} height={16} rx={2} fill="#f3f4f6" /><circle cx={16} cy={32} r={3} /><circle cx={28} cy={32} r={3} /><circle cx={40} cy={32} r={3} /><rect x={48} y={28} width={6} height={8} fill="#0ea5e9" stroke="none" /><path stroke={accent} d="M34 8 L28 18 H34 L30 22" /></g>);
      break;
    case 'ip-pbx':
      body = (<g {...s}><rect x={6} y={30} width={52} height={16} rx={2} fill="#f3f4f6" /><circle cx={14} cy={38} r={2} fill="#22c55e" stroke="none" /><path stroke={accent} d="M22 10 q-6 0 -6 6 q0 10 10 10 q6 0 6 -6 l-4 -2 l-2 3 q-5 -2 -6 -6 l3 -2 Z" /></g>);
      break;
    case 'load-balancer':
      body = (<g {...s}><rect x={6} y={26} width={52} height={14} rx={2} fill="#f3f4f6" /><path stroke={accent} d="M32 6 V16 M32 16 L16 22 M32 16 L32 22 M32 16 L48 22 M18 46 V56 M32 46 V56 M46 46 V56" /></g>);
      break;
    case 'tape-library':
      body = (<g {...s}><rect x={8} y={10} width={48} height={44} rx={3} fill="#f3f4f6" /><rect x={14} y={18} width={20} height={10} rx={1} /><rect x={14} y={34} width={20} height={10} rx={1} /><circle cx={45} cy={23} r={5} /><circle cx={45} cy={39} r={5} /></g>);
      break;
    case 'nvr':
      body = (<g {...s}><rect x={6} y={30} width={52} height={20} rx={2} fill="#f3f4f6" /><path d="M14 36 H26 M14 42 H26" /><circle cx={50} cy={40} r={2} fill="#dc2626" stroke="none" /><rect x={20} y={8} width={18} height={12} rx={3} fill="#e5e7eb" /><path d="M38 12 L46 8 V20 L38 16" fill="#e5e7eb" /></g>);
      break;
    case 'access-control':
      body = (<g {...s}><rect x={16} y={8} width={32} height={48} rx={3} fill="#f3f4f6" /><circle cx={32} cy={24} r={6} /><path d="M32 30 V40" /><rect x={28} y={36} width={8} height={10} rx={1} fill={accent} stroke="none" /></g>);
      break;
    case 'badge-reader':
      body = (<g {...s}><rect x={20} y={8} width={24} height={44} rx={5} fill="#f3f4f6" /><circle cx={32} cy={44} r={2} fill="#22c55e" stroke="none" /><path stroke={accent} d="M26 22 a8 8 0 0 1 12 0 M28 27 a4 4 0 0 1 8 0" /></g>);
      break;
    case 'alarm-panel':
      body = (<g {...s}><rect x={12} y={10} width={40} height={44} rx={3} fill="#f3f4f6" /><rect x={18} y={16} width={28} height={8} fill="#dbeafe" stroke={accent} /><path d="M20 32 H24 M30 32 H34 M40 32 H44 M20 40 H24 M30 40 H34 M40 40 H44 M20 48 H24 M30 48 H34 M40 48 H44" /></g>);
      break;
    case 'display':
      body = (<g {...s}><rect x={6} y={12} width={52} height={32} rx={2} fill="#dbeafe" stroke="#1f2937" /><path d="M24 44 L20 52 M40 44 L44 52 M16 52 H48" /></g>);
      break;
    case 'iot-device':
      body = (<g {...s}><circle cx={32} cy={34} r={14} fill="#f3f4f6" /><circle cx={32} cy={34} r={4} fill={accent} stroke="none" /><path stroke={accent} d="M16 14 a22 22 0 0 1 32 0 M22 20 a14 14 0 0 1 20 0" /></g>);
      break;
    case 'pos-terminal':
      body = (<g {...s}><rect x={14} y={10} width={36} height={24} rx={2} fill="#dbeafe" stroke="#1f2937" /><path d="M24 34 L20 44 H44 L40 34" fill="#e5e7eb" /><rect x={10} y={44} width={44} height={10} rx={2} fill="#f3f4f6" /></g>);
      break;
    case 'conference':
      body = (<g {...s}><rect x={8} y={8} width={48} height={28} rx={2} fill="#dbeafe" stroke="#1f2937" /><circle cx={32} cy={4} r={2} fill="#1f2937" stroke="none" /><ellipse cx={32} cy={50} rx={18} ry={5} fill="#f3f4f6" /><circle cx={32} cy={50} r={2} fill={accent} stroke="none" /></g>);
      break;
    case 'wall-jack':
      body = (<g {...s}><rect x={16} y={8} width={32} height={48} rx={4} fill="#fafafa" /><rect x={25} y={18} width={14} height={12} rx={1} fill="#1f2937" stroke="none" /><rect x={25} y={36} width={14} height={12} rx={1} fill="#1f2937" stroke="none" /><circle cx={32} cy={12} r={1.2} /><circle cx={32} cy={52} r={1.2} /></g>);
      break;
    case 'poe-injector':
      body = (<g {...s}><rect x={10} y={20} width={44} height={24} rx={4} fill="#f3f4f6" /><path stroke={accent} d="M34 24 L28 32 H34 L30 40" /><path d="M32 44 V54" /></g>);
      break;
    case 'media-converter':
      body = (<g {...s}><rect x={10} y={20} width={44} height={24} rx={3} fill="#f3f4f6" /><rect x={14} y={27} width={10} height={10} fill="#1f2937" stroke="none" /><rect x={40} y={27} width={10} height={10} fill="#ea580c" stroke="none" /><path stroke={accent} d="M26 32 H38 M34 28 L38 32 L34 36" /></g>);
      break;
    case 'sfp-module':
      body = (<g {...s}><rect x={8} y={24} width={40} height={16} rx={2} fill="#e5e7eb" /><rect x={48} y={26} width={8} height={12} fill="#22d3ee" /><path d="M8 32 H4 M14 28 H40" /></g>);
      break;
    case 'splice-closure':
      body = (<g {...s}><rect x={14} y={16} width={36} height={32} rx={14} fill="#1f2937" stroke="#1f2937" /><path stroke="#ea580c" d="M4 32 H14 M50 32 H60 M20 26 q12 10 24 0 M20 38 q12 -10 24 0" /></g>);
      break;
    case 'optical-splitter':
      body = (<g {...s}><rect x={16} y={20} width={32} height={24} rx={3} fill="#f3f4f6" /><path stroke="#ea580c" d="M32 8 V20 M32 28 L22 40 M32 28 V40 M32 28 L42 40" /></g>);
      break;
    case 'metro-ntu':
      body = (<g {...s}><rect x={6} y={26} width={52} height={14} rx={2} fill="#f3f4f6" /><rect x={10} y={30} width={8} height={6} fill="#ea580c" stroke="none" /><rect x={46} y={30} width={8} height={6} fill="#1f2937" stroke="none" /><path stroke={accent} d="M24 33 H40 M14 26 V12 M8 12 H20" /></g>);
      break;
    case 'olt':
      body = (<g {...s}><rect x={6} y={24} width={52} height={16} rx={2} fill="#f3f4f6" /><path stroke="#ea580c" d="M12 32 H20 M24 32 H32 M36 32 H44" strokeWidth={3} /><path stroke="#ea580c" d="M32 40 V48 M32 48 L20 56 M32 48 L44 56" /></g>);
      break;
    case 'dwdm':
      body = (<g {...s}><rect x={6} y={24} width={52} height={16} rx={2} fill="#f3f4f6" /><path d="M12 32 L24 32" stroke="#ea580c" strokeWidth={3} /><path d="M28 28 L52 28" stroke="#dc2626" /><path d="M28 32 L52 32" stroke="#16a34a" /><path d="M28 36 L52 36" stroke={accent} /></g>);
      break;
    case 'microwave':
      body = (<g {...s}><circle cx={26} cy={30} r={16} fill="#f3f4f6" /><circle cx={26} cy={30} r={6} /><path d="M26 46 V56 M18 56 H34" /><path stroke={accent} d="M46 22 a10 10 0 0 1 0 16 M52 18 a16 16 0 0 1 0 24" /></g>);
      break;
    case 'carrier-cloud':
      body = <g><path {...s} fill="#f5f3ff" stroke="#7c3aed" d="M16 46 a12 12 0 0 1 0-24 a16 16 0 0 1 30-4 a12 12 0 0 1 4 28 Z" /><text x={32} y={38} fontSize={10} textAnchor="middle" fill="#7c3aed" fontFamily="Arial" fontWeight={700}>METRO</text></g>;
      break;
    case 'building':
      body = (<g {...s}><rect x={14} y={10} width={36} height={46} fill="#f3f4f6" /><path d="M20 18 H26 M30 18 H36 M40 18 H44 M20 28 H26 M30 28 H36 M40 28 H44 M20 38 H26 M30 38 H36 M40 38 H44" strokeWidth={3} /><rect x={28} y={44} width={8} height={12} fill="#e5e7eb" /></g>);
      break;
    case 'sdwan':
      body = (<g {...s}><rect x={6} y={30} width={52} height={16} rx={2} fill="#f3f4f6" /><circle cx={14} cy={38} r={2} fill="#22c55e" stroke="none" /><path stroke={accent} d="M20 22 C24 8 40 8 44 22 M40 18 L44 22 L48 17" /><text x={36} y={42} fontSize={8} textAnchor="middle" fill="#1f2937" stroke="none" fontFamily="Arial">SD-WAN</text></g>);
      break;
    case 'vpn-concentrator':
      body = (<g {...s}><rect x={6} y={30} width={52} height={16} rx={2} fill="#f3f4f6" /><rect x={24} y={12} width={16} height={12} rx={2} fill="#d1fae5" stroke="#059669" /><path stroke="#059669" d="M27 12 V8 a5 5 0 0 1 10 0 V12" /></g>);
      break;
    case 'wan-optimizer':
      body = (<g {...s}><rect x={6} y={30} width={52} height={16} rx={2} fill="#f3f4f6" /><path stroke={accent} d="M12 20 H40 L34 14 M52 20 H44" /><path stroke={accent} d="M20 14 L14 20 L20 26" /></g>);
      break;
    case 'lte-router':
      body = (<g {...s}><rect x={8} y={32} width={48} height={18} rx={4} fill="#f3f4f6" /><path d="M16 32 V12 M48 32 V12" /><text x={32} y={45} fontSize={9} textAnchor="middle" fill="#c026d3" stroke="none" fontFamily="Arial" fontWeight={700}>5G</text><path stroke="#c026d3" d="M24 20 a10 10 0 0 1 16 0" /></g>);
      break;
    case 'satellite':
      body = (<g {...s}><path d="M12 40 a22 22 0 0 0 30 -30 Z" fill="#f3f4f6" /><path d="M27 25 L40 12 M24 42 L20 56 M12 56 H32" /><circle cx={42} cy={10} r={3} fill={accent} stroke="none" /><path stroke={accent} d="M48 4 a10 10 0 0 1 10 10" /></g>);
      break;
    case 'csu-dsu':
      body = (<g {...s}><rect x={8} y={26} width={48} height={16} rx={2} fill="#f3f4f6" /><text x={32} y={38} fontSize={8} textAnchor="middle" fill="#1f2937" stroke="none" fontFamily="Arial">T1/E1</text><path d="M32 26 V12" /></g>);
      break;
    case 'mpls-cloud':
      body = <g><path {...s} fill="#fff1f2" stroke="#be123c" d="M16 46 a12 12 0 0 1 0-24 a16 16 0 0 1 30-4 a12 12 0 0 1 4 28 Z" /><text x={32} y={38} fontSize={10} textAnchor="middle" fill="#be123c" fontFamily="Arial" fontWeight={700}>MPLS</text></g>;
      break;
    case 'cloud-service':
      body = <g><path {...s} fill="#ecfeff" stroke="#0891b2" d="M16 46 a12 12 0 0 1 0-24 a16 16 0 0 1 30-4 a12 12 0 0 1 4 28 Z" /><rect x={24} y={28} width={16} height={12} rx={1} fill="none" stroke="#0891b2" strokeWidth={2} /><path d="M27 32 H37 M27 36 H37" stroke="#0891b2" strokeWidth={1.5} /></g>;
      break;
    case 'remote-user':
      body = (<g {...s}><circle cx={24} cy={20} r={8} fill="#f3f4f6" /><path d="M10 50 a14 14 0 0 1 28 0" fill="#f3f4f6" /><rect x={36} y={34} width={18} height={14} rx={2} fill="#d1fae5" stroke="#059669" /><path stroke="#059669" d="M40 34 V30 a5 5 0 0 1 10 0 V34" /></g>);
      break;
    case 'ups':
      body = (<g {...s}><rect x={16} y={10} width={32} height={44} rx={3} fill="#f3f4f6" /><path stroke={accent} d="M34 18 L26 32 H34 L30 46" /></g>);
      break;
    default:
      body = <rect {...s} x={12} y={12} width={40} height={40} rx={4} fill="#f3f4f6" />;
  }
  return <svg viewBox="0 0 64 64" width={size} height={size} style={{ display: 'block' }}>{body}</svg>;
}

/** Small thumbnail for the stencil palette. */
export function StencilThumb({ stencil }: { stencil: StencilDef }) {
  if (stencil.style === 'icon') return <IconArt id={stencil.id} size={40} />;
  if (stencil.style === 'image') {
    const w = Math.min(120, stencil.width * stencil.scale);
    // eslint-disable-next-line @next/next/no-img-element -- user artwork as a data URL
    return <img src={stencil.image} alt="" width={w} height={(w * stencil.height) / stencil.width} draggable={false} style={{ display: 'block' }} />;
  }
  return (
    <svg viewBox={`0 0 ${stencil.width} ${stencil.height}`} width={120} height={(120 * stencil.height) / stencil.width} style={{ display: 'block' }}>
      <rect width={stencil.width} height={stencil.height} rx={3} fill={stencil.id.startsWith('patch') ? '#3b3b3e' : '#2a2a2c'} />
      {stencil.ports.map((p) => <PortArt key={p.id} port={p} state="idle" />)}
    </svg>
  );
}
