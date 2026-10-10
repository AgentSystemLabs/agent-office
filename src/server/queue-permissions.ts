/** Issues triage cannot schedule work. Scheduling belongs to the person's queue controls. */
export function queueWriteAllowed(station: string | undefined): boolean {
  return !!station && station !== 'issues';
}
