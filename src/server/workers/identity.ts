/** Keep a person's display name while giving git an ASCII branch-safe slug. */
export function workerSlug(name: string, id: string): string {
  const stem = name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'worker';
  return `${stem}-${id.slice(0, 4)}`;
}
