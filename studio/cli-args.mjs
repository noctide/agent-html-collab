export function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const [k, inline] = t.slice(2).split('=');
      const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (inline != null) a[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) a[key] = argv[++i];
      else a[key] = true;
    } else a._.push(t);
  }
  return a;
}
