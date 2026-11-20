'use client';

import { useReactFlow } from '@xyflow/react';
import { useState } from 'react';
import { setPref, usePref } from '@/lib/prefs';
import type { AppNode } from '@/lib/types';
import { useCurrentPage, useCurrentProject, useDiagram } from '@/store/useDiagramStore';

/** Opens the Comments panel; `detail.add` starts a new comment on the selected item. */
export const OPEN_COMMENTS_EVENT = 'netcraft:comments';
export const openComments = (add = false) => window.dispatchEvent(new CustomEvent(OPEN_COMMENTS_EVENT, { detail: { add } }));

const itemName = (n: AppNode) =>
  n.type === 'device' ? n.data.name : n.type === 'zone' ? n.data.title : n.type === 'shape' ? n.data.text || `Shape (${n.data.kind})` : n.type === 'note' ? 'Note' : n.type === 'measure' ? (n.data.variant === 'wall' ? 'Wall' : 'Dimension') : 'Item';

/** Visio-style Comments pane: every comment in the client, a box to add one to the selection, resolve or delete. */
export function CommentsPanel({ onClose, startAdding }: { onClose: () => void; startAdding: boolean }) {
  const rf = useReactFlow<AppNode>();
  const project = useCurrentProject();
  const page = useCurrentPage();
  const { addComment, updateComment, replyToComment, selectItem } = useDiagram.getState();
  const [replying, setReplying] = useState<string | null>(null); // comment id
  const [reply, setReply] = useState('');
  const postReply = (nodeId: string, commentId: string) => {
    if (!reply.trim()) return;
    replyToComment(nodeId, commentId, reply, author);
    setReply('');
    setReplying(null);
  };
  const author = usePref('author');
  const [text, setText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const selected = page.nodes.find((n) => n.selected && n.type !== 'backdrop');

  const threads = project.pages.flatMap((pg) =>
    pg.nodes.flatMap((n) => (n.type !== 'backdrop' && n.data.comments?.length ? [{ pg, n, comments: n.data.comments }] : [])),
  );
  const open = threads.reduce((k, t) => k + t.comments.filter((c) => !c.resolved).length, 0);

  const go = (pageId: string, id: string) => {
    selectItem(pageId, 'node', id);
    setTimeout(() => rf.fitView({ nodes: [{ id }], padding: 0.8, maxZoom: 1.5, duration: 300 }), 350);
  };
  const add = () => {
    if (!selected || !text.trim()) return;
    addComment(selected.id, text, author);
    setText('');
  };

  return (
    <div className="absolute right-2 top-2 z-20 flex max-h-[75%] w-80 max-w-[calc(100%-1rem)] flex-col rounded-lg border border-gray-200 bg-white shadow-lg" role="dialog" aria-label="Comments">
      <header className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-900">Comments</h2>
        <span className="text-[11px] text-gray-500">{open} open</span>
        <button className="ml-auto rounded px-1.5 text-gray-500 hover:bg-gray-100" onClick={onClose} aria-label="Close comments">×</button>
      </header>
      <div className="border-b border-gray-100 p-2">
        {selected ? (
          <>
            <div className="mb-1 text-[11px] text-gray-500">New comment on <b className="text-gray-800">{itemName(selected)}</b></div>
            <textarea
              autoFocus={startAdding}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
              rows={2}
              placeholder="Type a comment… (Ctrl+Enter to post)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
            />
            <div className="mt-1 flex items-center gap-2">
              <input className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-0.5 text-xs" placeholder="Your name" value={author} onChange={(e) => setPref('author', e.target.value)} aria-label="Your name" />
              <button className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50" disabled={!text.trim()} onClick={add}>Post</button>
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-500">Select a device or shape to comment on it.</p>
        )}
      </div>
      <div className="flex items-center justify-between px-3 py-1 text-[11px] text-gray-600">
        <label className="flex items-center gap-1"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
        <span className="text-gray-400">All pages</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2 text-xs">
        {threads.length === 0 && <li className="px-3 py-3 text-center text-gray-400">No comments yet.</li>}
        {threads.map(({ pg, n, comments }) => {
          const shown = comments.filter((c) => showResolved || !c.resolved);
          if (!shown.length) return null;
          return (
            <li key={n.id} className="border-t border-gray-100 px-3 pt-2">
              <button className="mb-1 text-left text-[11px] font-semibold text-blue-700 hover:underline" onClick={() => go(pg.id, n.id)}>
                {itemName(n)}{project.pages.length > 1 && <span className="font-normal text-gray-400"> · {pg.name}</span>}
              </button>
              {shown.map((c) => (
                <div key={c.id} className={`group mb-1.5 rounded border px-2 py-1 ${c.resolved ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-amber-200 bg-amber-50 text-gray-800'}`}>
                  <div className="whitespace-pre-wrap">{c.text}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                    <span>{c.author || 'Someone'} · {new Date(c.at).toLocaleString()}</span>
                    <button className="ml-auto text-blue-600 hover:underline" onClick={() => { setReplying(replying === c.id ? null : c.id); setReply(''); }}>Reply{c.replies?.length ? ` (${c.replies.length})` : ''}</button>
                    <button className="hidden text-blue-600 hover:underline group-hover:inline" onClick={() => updateComment(n.id, c.id, { resolved: !c.resolved })}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
                    <button className="hidden text-red-600 hover:underline group-hover:inline" onClick={() => updateComment(n.id, c.id, null)}>Delete</button>
                  </div>
                  {(c.replies ?? []).map((r) => (
                    <div key={r.id} className="mt-1 border-l-2 border-amber-300 pl-2">
                      <div className="whitespace-pre-wrap">{r.text}</div>
                      <div className="text-[10px] text-gray-500">{r.author || 'Someone'} · {new Date(r.at).toLocaleString()}</div>
                    </div>
                  ))}
                  {replying === c.id && (
                    <div className="mt-1 flex gap-1">
                      <textarea
                        autoFocus rows={2}
                        className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-blue-500"
                        placeholder="Reply… (Ctrl+Enter)"
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); postReply(n.id, c.id); } if (e.key === 'Escape') setReplying(null); }}
                      />
                      <button className="self-end rounded bg-blue-600 px-2 py-0.5 text-[11px] text-white hover:bg-blue-700 disabled:opacity-50" disabled={!reply.trim()} onClick={() => postReply(n.id, c.id)}>Reply</button>
                    </div>
                  )}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
