// Detection shim for the IWSDK CLI (see package.json next to this file): its existence is
// what matters, so the CLI resolves the XR test runtime at the Vite root. The real config is
// ../../vite.config.ts; dev:runtime passes it via --config and never loads this file.
export default {};
