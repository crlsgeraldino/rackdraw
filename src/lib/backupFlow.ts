'use client';

/*
 * "Back up everything" as the user sees it (File menu, the red "not saved" bar, the crash screen): offers a password,
 * warns when protected clients would go into an unprotected backup, and reports what really happened — in the desktop
 * app the Save dialog can be cancelled or the disk can be full, so "backed up" is only said when the file was saved.
 */
import { askPassword } from '@/components/PasswordHost';
import { useDiagram } from '@/store/useDiagramStore';
import { downloadBackup } from './backup';
import { withDownloadResult } from './export';
import { isProtected } from './fileSave';

export async function backUpEverything(): Promise<void> {
  const pw = await askPassword({
    title: 'Back up everything',
    message: 'Protect the backup with a password? Leave it empty for no password.\nThe backup holds every client, your stencils, templates, Version History and price book.',
    confirm: true, optional: true, okLabel: 'Back up',
  });
  if (pw === null) return;
  if (!pw) {
    const locked = Object.values(useDiagram.getState().projects).filter((p) => isProtected(p.id)).map((p) => p.name);
    if (locked.length && !confirm(`${locked.length === 1 ? `"${locked[0]}" is` : `${locked.length} clients are`} password-protected, but this backup has no password: anyone with the backup file could read ${locked.length === 1 ? 'it' : 'them'}.\n\nBack up without a password anyway?`)) return;
  }
  let outcome;
  try {
    outcome = await withDownloadResult(() => downloadBackup(pw || undefined));
  } catch (e) {
    alert(`The backup could not be made: ${(e as Error).message}`);
    return;
  }
  const { value: n, result } = outcome;
  if (result === 'cancelled') { alert('The backup was not saved.'); return; }
  if (result === 'failed') { alert('The backup could not be saved there (the disk may be full). Try another place, such as another drive or a USB stick.'); return; }
  const what = `${n} client${n === 1 ? '' : 's'}, your stencils, templates, Version History and price book`;
  const how = pw ? ', protected with your password' : '';
  alert(result === 'saved'
    ? `Backed up ${what} to one file${how}. Keep it somewhere safe (another drive or the cloud).`
    : `The backup of ${what} is downloading${how}. Keep it somewhere safe (another drive or the cloud).`);
}
