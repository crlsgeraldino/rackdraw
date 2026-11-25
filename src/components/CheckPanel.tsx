'use client';

import { useReactFlow } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { checkProject, type Issue, type Severity } from '@/lib/check';
import type { AppNode } from '@/lib/types';
import { getStencil, useCurrentProject, useDiagram } from '@/store/useDiagramStore';
import { safeFitView } from '@/lib/fit';
import { useEscape } from '@/lib/useEscape';

/** Fired by the Arrange menu to open the Check diagram panel on the canvas. */
export const OPEN_CHECK_EVENT = 'netcraft:check-diagram';

const STYLE: Record<Severity, { label: string; dot: string; text: string }> = {
  error: { label: 'Errors', dot: 'bg-red-600', text: 'text-red-700' },
  warning: { label: 'Warnings', dot: 'bg-amber-500', text: 'text-amber-700' },
  info: { label: 'Missing details', dot: 'bg-blue-500', text: 'text-blue-700' },
};

/** Visio-style "Check diagram": live list of problems in this client's documentation; click one to go to it. */
export function CheckPanel({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const { selectItem } = useDiagram.getState();
  const [showInfo, setShowInfo] = useState(false);
  const issues = useMemo(() => checkProject(project, getStencil), [project]);
  const counts = { error: 0, warning: 0, info: 0 } as Record<Severity, number>;
  issues.forEach((i) => counts[i.severity]++);
  const shown = issues.filter((i) => showInfo || i.severity !== 'info');

  const go = (i: Issue) => {
    selectItem(i.pageId, i.kind, i.id);
    setTimeout(() => {
      const pg = useDiagram.getState().projects[project.id].pages.find((p) => p.id === i.pageId);
      const edge = i.kind === 'edge' ? pg?.edges.find((e) => e.id === i.id) : undefined;
      safeFitView(rf, { nodes: (edge ? [edge.source, edge.target] : [i.id]).map((id) => ({ id })), padding: 0.6, maxZoom: 1.5, duration: 300 });
    }, 350);
  };

  return (
    <div className="absolute right-2 top-2 z-20 flex max-h-[70%] w-96 max-w-[calc(100%-1rem)] flex-col rounded-lg border border-gray-200 bg-white shadow-lg" role="dialog" aria-label="Check diagram">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-900">Check diagram</h2>
        <div className="flex gap-2 text-[11px]">
          {(['error', 'warning', 'info'] as Severity[]).map((s) => (
            <span key={s} className={`flex items-center gap-1 ${counts[s] ? STYLE[s].text : 'text-gray-400'}`}>
              <span className={`h-2 w-2 rounded-full ${counts[s] ? STYLE[s].dot : 'bg-gray-300'}`} />{counts[s]}
            </span>
          ))}
        </div>
        <button className="ml-auto rounded px-1.5 text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close check diagram">×</button>
      </header>
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1 text-[11px] text-gray-600">
        <label className="flex items-center gap-1"><input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} /> Show missing details (IP, serial, unconnected)</label>
        <span className="text-gray-400">All pages</span>
      </div>
      {shown.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-green-700">
          {issues.length ? `No errors or warnings. ${counts.info} missing detail${counts.info === 1 ? '' : 's'} hidden.` : 'Everything checks out.'}
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto py-1 text-xs">
          {shown.map((i, k) => (
            <li key={`${i.rule}:${i.id}:${k}`}>
              <button className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => go(i)}>
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STYLE[i.severity].dot}`} />
                <span className="min-w-0">
                  <span className={`font-medium ${STYLE[i.severity].text}`}>{i.rule}</span>
                  {project.pages.length > 1 && <span className="text-gray-400"> · {project.pages.find((p) => p.id === i.pageId)?.name}</span>}
                  <span className="block text-gray-700">{i.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-400">Updates as you edit. Click a problem to go to it.</p>
    </div>
  );
}
