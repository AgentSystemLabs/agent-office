// The core's slices: how the store's own fields (see Store) follow the server's messages. They're
// registered with the feature slices, in among them (./slices/index.ts), because on `welcome` their
// topics fire in among the features' ones.

import type { PeerInfo } from '../../shared/protocol';
import { rememberFloor } from './persist';
import type { MsgOf, Slice, Take } from './store';

const peerUpdate: Take<MsgOf<'peer.join' | 'peer.update'>> = (s, m) => {
  s.peers.set(m.peer.id, m.peer);
  return ['peers'];
};

const peersOf = (peers: PeerInfo[]) => new Map(peers.map((p) => [p.id, p]));

/** You, and the people in the building: where they are, and what they said in the chat. */
export const presence: Slice = {
  on: {
    welcome(s, m) {
      s.you = m.you;
      s.peers = peersOf(m.peers);
      s.ice = m.ice as RTCIceServer[];
      s.chat = m.chat;
      s.invites = m.invites;
      return ['peers', 'chat'];
    },
    'floor.enter'(s, m) {
      s.peers = peersOf(m.peers);
      return ['peers'];
    },
    'peer.join': peerUpdate,
    'peer.update': peerUpdate,
    'peer.move'(s, m) {
      const p = s.peers.get(m.id);
      if (p) Object.assign(p, { x: m.x, y: m.y, z: m.z, rotY: m.rotY, moving: m.moving });
    },
    'peer.leave'(s, m) {
      s.peers.delete(m.id);
      return ['peers'];
    },
    chat(s, m) {
      s.chat.push(m);
      if (s.chat.length > 200) s.chat.shift();
      return ['chat'];
    },
  },
};

/** Who you're signed in as. */
export const me: Slice = {
  on: {
    welcome(s, m) {
      s.me = m.me;
      return ['me'];
    },
    me(s, m) {
      s.me = m.me;
      return ['me'];
    },
  },
};

/** The building's floors, where new ones are cloned to, and the repositories that could be one. */
export const building: Slice = {
  on: {
    welcome(s, m) {
      s.floors = m.floors;
      s.projectsDir = m.projectsDir;
      return ['floors', 'projectsDir'];
    },
    floors(s, m) {
      s.floors = m.floors;
      return ['floors'];
    },
    projectsDir(s, m) {
      s.projectsDir = m.state;
      return ['projectsDir'];
    },
    'floor.repos'(s, m) {
      s.repos = { list: m.repos, error: m.error, loading: false, at: Date.now() };
      return ['repos'];
    },
  },
};

/** The floor you're on: its project, its workers and their screens, its issues, pull requests and queue. */
export const floor: Slice = {
  enter(s, v) {
    s.floor = v.floor;
    rememberFloor(v.floor);
    s.project = v.project;
    s.workers = new Map(v.workers.map((w) => [w.id, w]));
    s.screens.clear(); // fresh full frames follow
    s.issues = v.issues;
    s.pulls = v.pulls;
    s.queue = v.queue;
    return ['floor', 'project', 'workers', 'issues', 'pulls', 'queue'];
  },
  on: {
    'worker.update'(s, m) {
      s.workers.set(m.worker.id, m.worker);
      return ['workers'];
    },
    'worker.remove'(s, m) {
      s.workers.delete(m.workerId);
      s.screens.delete(m.workerId);
      return ['workers'];
    },
    screen(s, m) {
      let sc = s.screens.get(m.workerId);
      if (!sc || m.full || sc.cols !== m.cols || sc.rows !== m.rows) {
        sc = { cols: m.cols, rows: m.rows, lines: [], cursor: m.cursor, version: (sc?.version ?? 0) + 1 };
        s.screens.set(m.workerId, sc);
      }
      for (const [k, v] of Object.entries(m.lines)) sc.lines[Number(k)] = v;
      sc.cursor = m.cursor;
      sc.version++;
      return ['screens'];
    },
    'gh.issues'(s, m) {
      s.issues = m.state;
      return ['issues'];
    },
    'gh.pulls'(s, m) {
      s.pulls = m.state;
      return ['pulls'];
    },
    queue(s, m) {
      s.queue = m.state;
      return ['queue'];
    },
  },
};
