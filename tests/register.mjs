// Loads the app's TypeScript (and the JSX in lib/stencils.tsx) for Node's test runner, through jiti (it comes with
// Tailwind 4, so no extra package is installed).
process.env.JITI_JSX ??= '1';
await import('jiti/register');
