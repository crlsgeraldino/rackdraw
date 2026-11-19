'use client';

import { get as idbGet, set as idbSet } from 'idb-keyval';
import { useRef, useState } from 'react';
import { readTable, type Table } from '@/lib/dataImport';
import { exportDeviceList } from '@/lib/export';
import { useCurrentProject } from '@/store/useDiagramStore';
import { DataImportDialog } from './DataImportDialog';

type Handle = { getFile: () => Promise<File>; queryPermission?: (o: object) => Promise<string>; requestPermission?: (o: object) => Promise<string> };
type Picker = (o: object) => Promise<Handle[]>;

const handleKey = (projectId: string) => `netcraft-link:${projectId}`;
const pickerTypes = [{ description: 'Spreadsheets', accept: { 'text/csv': ['.csv'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }];

/**
 * Toolbar "Data" menu. Where the browser supports it (Edge/Chrome), the picked file's handle is remembered so
 * Refresh re-reads the same file after you edit it; otherwise Refresh asks for the file again.
 */
export function DataMenu() {
  const project = useCurrentProject();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<{ fileName: string; table: Table; refresh: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const refreshing = useRef(false);
  const picker = typeof window !== 'undefined' ? (window as unknown as { showOpenFilePicker?: Picker }).showOpenFilePicker : undefined;

  const load = async (file: File, refresh: boolean) => {
    try {
      setDialog({ fileName: file.name, table: await readTable(file), refresh });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const pick = async (refresh: boolean) => {
    setOpen(false);
    if (picker) {
      try {
        const [h] = await picker({ types: pickerTypes, multiple: false });
        await idbSet(handleKey(project.id), h).catch(() => {});
        await load(await h.getFile(), refresh);
      } catch {
        // cancelled
      }
    } else {
      refreshing.current = refresh;
      inputRef.current?.click();
    }
  };

  const refresh = async () => {
    setOpen(false);
    const h = await idbGet<Handle>(handleKey(project.id)).catch(() => undefined);
    if (h) {
      try {
        const ok = (await h.queryPermission?.({ mode: 'read' })) === 'granted' || (await h.requestPermission?.({ mode: 'read' })) === 'granted';
        if (ok) return load(await h.getFile(), true);
      } catch {
        // file moved or permission refused: fall back to asking
      }
    }
    alert(`Pick "${project.dataLink?.fileName}" again (the browser can't reopen it on its own).`);
    pick(true);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">Data ▾</button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded border border-gray-200 bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setOpen(false)}>
          <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => pick(false)}>
            Import from Excel / CSV… <span className="block text-xs text-gray-400">Update devices from a spreadsheet</span>
          </button>
          {project.dataLink && (
            <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={refresh}>
              Refresh from “{project.dataLink.fileName}”
              <span className="block text-xs text-gray-400">Last applied {new Date(project.dataLink.lastApplied).toLocaleString()}</span>
            </button>
          )}
          <button className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => { setOpen(false); exportDeviceList(project); }}>
            Export device list (CSV) <span className="block text-xs text-gray-400">Edit in Excel, then import it back</span>
          </button>
        </div>
      )}
      <input ref={inputRef} type="file" hidden accept=".csv,.xlsx,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f, refreshing.current); e.target.value = ''; }} />
      {dialog && (
        <DataImportDialog
          key={`${dialog.fileName}:${dialog.table.rows.length}`}
          fileName={dialog.fileName}
          table={dialog.table}
          link={dialog.refresh ? project.dataLink : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
