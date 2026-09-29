/**
 * The sandbox's Python package sources (./py/**), keyed by their path inside the Pyodide
 * filesystem's library dir. Bundled as raw strings so no extra fetches are needed.
 */
const modules = import.meta.glob<string>('./py/**/*.py', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const PYTHON_FILES: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([path, source]) => [path.replace(/^\.\/py\//, ''), source]),
);
