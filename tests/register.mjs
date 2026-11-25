// Loads the app's TypeScript (and the JSX in lib/stencils.tsx) for Node's test runner, through jiti (it comes with
// Tailwind 4, so no extra package is installed). The "@/" import alias points at src/, as in the app.
import { fileURLToPath } from 'node:url';

process.env.JITI_JSX ??= '1';
process.env.JITI_ALIAS ??= JSON.stringify({ '@/': fileURLToPath(new URL('../src/', import.meta.url)) });
await import('jiti/register');
