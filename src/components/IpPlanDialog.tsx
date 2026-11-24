'use client';

import { useEffect, useMemo, useState } from 'react';
import { downloadBlob, safeName } from '@/lib/export';
import { deviceIps, ipPlanProblems, subnetUsage, undefinedVlans, vlanOfIp, vlansInUse, type VlanDef } from '@/lib/ipam';
import { writeXlsx } from '@/lib/xlsx';
import { useCurrentProject, useDiagram } from '@/store/useDiagramStore';

const uid = () => Math.random().toString(36).slice(2, 10);

/** Usual names for the VLAN numbers MSPs use most, so "Add VLANs used in the diagram" starts with a sensible name. */
const COMMON: Record<string, string> = { '1': 'Management', '10': 'Data', '20': 'Voice', '30': 'Cameras', '40': 'Guest Wi-Fi', '50': 'IoT', '99': 'Out-of-band' };

const PLAN_HEADER = ['VLAN', 'Name', 'Subnet', 'Gateway', 'DHCP start', 'DHCP end', 'Static used', 'DHCP pool', 'Free', 'Next free IP', 'Notes'];
const IP_HEADER = ['IP', 'Device', 'VLAN', 'Subnet', 'Check'];

/** Data → IP Plan: the client's VLANs and subnets, how full they are, and every device IP checked against them. */
export function IpPlanDialog({ onClose }: { onClose: () => void }) {
  const project = useCurrentProject();
  const updateProject = useDiagram((s) => s.updateProject);
  const snapshot = useDiagram((s) => s.snapshot);
  const vlans = useMemo(() => project.vlans ?? [], [project.vlans]);
  const usage = useMemo(() => subnetUsage(project), [project]);
  const problems = useMemo(() => ipPlanProblems(project), [project]);
  const missing = useMemo(() => undefinedVlans(project), [project]);
  const ips = useMemo(() => deviceIps(project).sort((a, b) => a.n - b.n), [project]);
  const [tab, setTab] = useState<'plan' | 'ips'>('plan');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const save = (list: VlanDef[]) => updateProject({ vlans: list });
  const change = (id: string, patch: Partial<VlanDef>) => save(vlans.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const add = (v: Partial<VlanDef> = {}) => { snapshot(); save([...vlans, { id: `v-${uid()}`, vlan: '', name: '', ...v }]); };
  const remove = (v: VlanDef) => {
    if (!confirm(`Remove VLAN ${v.vlan} ${v.name} from the IP plan? Devices and cables keep their IPs and VLAN numbers.`)) return;
    snapshot();
    save(vlans.filter((x) => x.id !== v.id));
  };
  const addUsed = () => {
    const have = new Set(vlans.map((v) => v.vlan.trim()));
    const add = vlansInUse(project).filter((x) => !have.has(x));
    if (!add.length) return alert('Every VLAN used on cables and ports is already in the plan.');
    snapshot();
    save([...vlans, ...add.map((x) => ({ id: `v-${uid()}`, vlan: x, name: COMMON[x] ?? '' }))]);
  };

  const problemOf = (deviceId: string) => problems.filter((x) => x.deviceId === deviceId).map((x) => x.rule).join('; ');
  const planRows = usage.map((u) => [u.vlan.vlan, u.vlan.name, u.vlan.subnet ?? '', u.vlan.gateway ?? '', u.vlan.dhcpStart ?? '', u.vlan.dhcpEnd ?? '', u.subnet ? u.used : '', u.subnet ? u.dhcp : '', u.subnet ? u.free : '', u.next ?? '', u.vlan.notes ?? '']);
  const ipRows = ips.map((x) => { const v = vlanOfIp(x.ip, vlans); return [x.ip, x.device.data.name, v ? `${v.vlan} ${v.name}`.trim() : '', v?.subnet ?? '', problemOf(x.device.id)]; });
  const [header, rows] = tab === 'plan' ? [PLAN_HEADER, planRows] : [IP_HEADER, ipRows];
  const file = `${safeName(project.name)}-${tab === 'plan' ? 'ip-plan' : 'ip-addresses'}`;
  const toExcel = () => downloadBlob(`${file}.xlsx`, new Blob([writeXlsx(tab === 'plan' ? 'IP plan' : 'IP addresses', header, rows) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const toCsv = () => downloadBlob(`${file}.csv`, new Blob(['﻿' + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText([header, ...rows].map((r) => r.map((c) => String(c).replace(/[\t\n]+/g, ' ')).join('\t')).join('\n'));
    } catch {
      alert('Copying was blocked by the system. Click inside RackDraw and press Copy again, or use CSV / Excel.');
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const btn = 'rounded-md border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-50';
  const cell = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-gray-300 hover:border-slate-300 focus:border-blue-500 focus:bg-white';
  const input = (v: VlanDef, key: keyof VlanDef, placeholder: string, mono = true, w = '') => (
    <input
      className={`${cell} ${mono ? 'font-mono' : ''} ${w}`}
      value={(v[key] as string) ?? ''}
      placeholder={placeholder}
      aria-label={`${placeholder} for VLAN ${v.vlan}`}
      onFocus={snapshot}
      onChange={(e) => change(v.id, { [key]: e.target.value })}
    />
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] w-[min(1180px,97vw)] flex-col rounded-lg bg-white shadow-xl" role="dialog" aria-modal="true" aria-label="IP plan">
        <div className="flex items-center border-b border-gray-200 px-4 py-2">
          <h2 className="text-base font-semibold text-gray-800">IP plan</h2>
          <span className="ml-3 text-xs text-gray-500">VLANs and subnets of {project.name}. Check Diagram flags IPs outside the plan, in a DHCP range, or on a network / broadcast address.</span>
          <button className="ml-auto rounded px-2 text-lg text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="flex items-center gap-1 border-b border-gray-200 px-4 py-1.5" role="tablist">
          {([['plan', `VLANs & subnets (${vlans.length})`], ['ips', `IP addresses (${ips.length})`]] as const).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-blue-50 font-medium text-blue-800' : 'text-gray-600 hover:bg-gray-50'}`} onClick={() => setTab(t)}>{label}</button>
          ))}
          <div className="ml-auto flex gap-1.5">
            <button className={btn} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <button className={btn} onClick={toCsv}>CSV</button>
            <button className="rounded-md bg-blue-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-blue-700" onClick={toExcel}>Excel</button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'plan' && (
            <>
              {vlans.length ? (
                <table className="w-full table-fixed text-sm">
                  <colgroup>
                    <col className="w-16" /><col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col className="w-[11%]" /><col /><col className="w-[10%]" /><col className="w-7" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-gray-300 text-left text-xs text-gray-500">
                      <th className="py-1 font-medium">VLAN</th><th className="py-1 font-medium">Name</th><th className="py-1 font-medium">Subnet</th><th className="py-1 font-medium">Gateway</th>
                      <th className="py-1 font-medium">DHCP start</th><th className="py-1 font-medium">DHCP end</th><th className="py-1 font-medium">Use</th><th className="py-1 font-medium">Next free</th><th className="w-6" />
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((u) => {
                      const v = u.vlan;
                      // How full the static space is (the subnet minus its DHCP pool): that's what runs out.
                      const pct = u.subnet ? u.used / Math.max(1, u.used + u.free) : 0;
                      return (
                        <tr key={v.id} className="border-b border-gray-100 align-middle">
                          <td className="py-1 pr-1">{input(v, 'vlan', 'VLAN')}</td>
                          <td className="py-1 pr-1">{input(v, 'name', 'Name', false)}</td>
                          <td className="py-1 pr-1">
                            {input(v, 'subnet', '10.0.10.0/24')}
                            {v.subnet && !u.subnet && <span className="px-1 text-[10px] text-red-600">Not a subnet (use CIDR, e.g. 10.0.10.0/24)</span>}
                          </td>
                          <td className="py-1 pr-1">{input(v, 'gateway', 'Gateway')}</td>
                          <td className="py-1 pr-1">{input(v, 'dhcpStart', 'DHCP start')}</td>
                          <td className="py-1 pr-1">{input(v, 'dhcpEnd', 'DHCP end')}</td>
                          <td className="whitespace-nowrap py-1 pr-2 text-xs text-gray-600">
                            {u.subnet ? (
                              <span title={`${u.used} static (devices + gateway), ${u.free} static free, ${u.dhcp} in the DHCP pool, ${u.subnet.hosts} usable in all`}>
                                <span className="inline-block h-1.5 w-14 overflow-hidden rounded bg-gray-200 align-middle">
                                  <span className={`block h-full ${pct >= 0.9 ? 'bg-red-500' : pct >= 0.75 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                                </span>
                                <span className="ml-1.5 tabular-nums">{u.used} static · {u.free} free</span>
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-1 pr-1 font-mono text-xs text-gray-700">{u.next ?? ''}</td>
                          <td className="py-1"><button className="rounded px-1 text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(v)} aria-label={`Remove VLAN ${v.vlan}`} title="Remove from the plan">✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="mb-3 text-sm text-gray-600">No VLANs yet. Add the ones this client uses, with their subnet (e.g. <span className="font-mono">10.0.10.0/24</span>), gateway and DHCP range: Check Diagram then catches IP mistakes, and devices get a &quot;next free IP&quot;.</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className={btn} onClick={() => add()}>+ Add VLAN</button>
                <button className={btn} onClick={addUsed} title="Adds every VLAN number used on cables and ports that isn't in the plan yet">Add VLANs used in the diagram</button>
                {missing.length > 0 && <span className="text-xs text-amber-700">Used on cables / ports but not in the plan: VLAN {missing.join(', ')}</span>}
              </div>
              {problems.filter((x) => !x.deviceId).length > 0 && (
                <ul className="mt-3 space-y-0.5 text-xs text-amber-800">
                  {problems.filter((x) => !x.deviceId).map((x, i) => <li key={i}>⚠ {x.message}</li>)}
                </ul>
              )}
            </>
          )}

          {tab === 'ips' && (ips.length ? (
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-300 text-left text-xs text-gray-500">{IP_HEADER.map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {ipRows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1 pr-3 font-mono">{r[0]}</td>
                    <td className="py-1 pr-3 text-gray-800">{r[1]}</td>
                    <td className="py-1 pr-3 text-gray-600">{r[2]}</td>
                    <td className="py-1 pr-3 font-mono text-xs text-gray-500">{r[3]}</td>
                    <td className="py-1 text-xs text-amber-700">{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-500">No device has an IP yet.</p>)}
        </div>
      </div>
    </div>
  );
}
