## Summary

<!-- What this PR does and why. Link the issue: "Closes #123" or "Part of #123". -->

## What changed

<!-- The main changes, one bullet each. Call out anything reviewers should look at closely. -->

-

## How it was validated

<!-- Commands you ran and what you checked by hand (desktop browser, WebXR headset, GitHub or GitLab floor, provider). -->

## CI checks

These are the checks `.github/workflows/release.yml` runs on this PR, in order. Run the first four locally before you push.

- [ ] `npm ci` (its `prepare` script runs `npm run build`, building the client and the server)
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run test:coverage` (the tests, failing below the coverage thresholds in `package.json`)
- [ ] Pack the release (`npm pack` of the built app with `npm-shrinkwrap.json`)
- [ ] Install the packed release with `install.sh` and start it (smoke test: `/login.html` answers 200)

`release.yml` runs only on pull requests that touch a path in its `pull_request.paths` filter.

## Review checklist

- [ ] `PTY_PROTOCOL` in `src/server/ptys.ts` is bumped if code the PTY host runs changed (see `src/server/AGENTS.md`)
- [ ] `README.md` and `AGENTS.md` are updated for user-visible behavior
- [ ] Any new check is also a step in `.github/workflows/release.yml`, and the CI checks list above matches it
