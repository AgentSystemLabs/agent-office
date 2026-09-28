// Installs the git hooks from `prepare`. CI and installs without dev dependencies have no use for
// them (and no husky), so they skip it rather than fail the install.
if (process.env.CI === 'true' || process.env.NODE_ENV === 'production') process.exit(0);
let husky;
try {
  husky = (await import('husky')).default;
} catch {
  process.exit(0);
}
const note = husky();
if (note) console.log(`husky: ${note}`);
