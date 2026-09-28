# Shared

- Both `tsconfig.server.json` (Node types, no DOM lib) and `tsconfig.client.json` (DOM lib, no Node types) compile this directory. Use only ES2022 APIs: no `node:` imports, Node globals (`process`, `Buffer`) or DOM globals (`window`, `document`).
- Relative imports end in `.js`; the server build needs NodeNext resolution.
- `protocol.ts` defines the WebSocket messages (`ClientMsg`, `ServerMsg`). A change to either updates the server handlers (`src/server/server.ts`, `src/server/floor.ts`) and the client (`src/client/net.ts`, `src/client/state.ts`, and the `src/client/ui/` windows that send or read the message) in the same change.
