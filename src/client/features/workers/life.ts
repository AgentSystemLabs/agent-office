// The office's little life ledger: it notices the moments that make the place feel like a game —
// friendships made, dance-floor parties, coffee runs — celebrates them in the room (confetti and
// a quip from whoever's there), and keeps the score in localStorage per floor.
import { relation } from '../../../shared/traits';
import { store } from '../../state';
import type { Confetti } from '../../world/confetti';
import type { Roamer } from './roamer';
import type { Wander } from './wander';

interface Stats {
  /** Chats ended, friendships and rivalries formed, dance parties thrown, coffees poured. */
  chats: number;
  friends: number;
  rivals: number;
  parties: number;
  coffees: number;
}

const fresh = (): Stats => ({ chats: 0, friends: 0, rivals: 0, parties: 0, coffees: 0 });
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

const FRIEND = ['¡por fin alguien que me entiende!', '¡nos caemos bien!', '¡equipo!', '¡por fin una amistad en esta oficina!'];
const RIVAL = ['uff, ya empezamos', 'esto lo resuelvo yo solo', 'ajá, tu otra vez'];
const PARTY = ['¡la pista está llena!', '¡este beat sí pega!', '¡fiesta en la oficina!', '¡a bailar se ha dicho!'];
const COFFEE = ['este café sí pega', 'la máquina hoy está de buen humor', '¡qué aromaticazo!', 'con esto aguanto otro sprint'];

/** Three or more at the DJ spots is a party; two or fewer ends it. */
const PARTY_AT = 3;
const PARTY_OVER_AT = 2;

export class OfficeLife {
  private stats: Stats = fresh();
  /** Where each pair stands socially, so a friendship is celebrated once until it cools off. */
  private readonly pairs = new Map<string, 'friend' | 'rival' | 'neutral'>();
  private party = false;
  private readonly atCoffee = new Set<string>();
  private poll = 0;
  private key = '';

  constructor(
    private wander: Wander,
    private confetti: Confetti,
  ) {
    this.key = `office-life:${store.project?.dir ?? ''}`;
    try {
      this.stats = { ...fresh(), ...(JSON.parse(localStorage.getItem(this.key) ?? '{}') as Partial<Stats>) };
    } catch {
      // A broken ledger just starts over.
    }
  }

  private save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.stats));
    } catch {
      // Private mode or a full store: the party still happened.
    }
  }

  private pairKey(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  /** Confetti between them and a quip from one of them, in their own voice. */
  private celebrate(a: Roamer, b: Roamer, quip: string) {
    const pa = a.model.root.position;
    const pb = b.model.root.position;
    this.confetti.burst((pa.x + pb.x) / 2, 1.6, (pa.z + pb.z) / 2, 120, 0.7);
    this.wander.say(Math.random() < 0.5 ? a.id : b.id, quip);
  }

  /** A chat just ended: count it, and make something of it when the pair crosses into friends or rivals. */
  chatEnded(a: Roamer, b: Roamer, next: number) {
    this.stats.chats++;
    const k = this.pairKey(a.id, b.id);
    const rel = relation(next) === 'stranger' ? 'neutral' : relation(next);
    const was = this.pairs.get(k) ?? 'neutral';
    if (rel !== was) {
      if (rel === 'friend') {
        this.stats.friends++;
        this.celebrate(a, b, pick(FRIEND));
      } else if (rel === 'rival') {
        this.stats.rivals++;
        // A rivalry isn't a party: just a mutter from one of them.
        this.wander.say(Math.random() < 0.5 ? a.id : b.id, pick(RIVAL));
      }
      this.pairs.set(k, rel);
    }
    this.save();
  }

  /** The mood of the room, read a few times a second: who's at the DJ booth, who's at the coffee machine. */
  update(dt: number) {
    this.poll -= dt;
    if (this.poll > 0) return;
    this.poll = 0.75;
    const hang = this.wander.hangouts();
    // The dance floor: a party starts when enough people gather, ends when it thins out.
    const dancers = hang.filter((h) => h.kind === 'dj');
    if (!this.party && dancers.length >= PARTY_AT) {
      this.party = true;
      this.stats.parties++;
      const x = dancers.reduce((s, d) => s + d.x, 0) / dancers.length;
      const z = dancers.reduce((s, d) => s + d.z, 0) / dancers.length;
      this.confetti.burst(x, 2.2, z, 200, 1);
      this.wander.say(pick(dancers).id, pick(PARTY));
      this.save();
    } else if (this.party && dancers.length <= PARTY_OVER_AT) {
      this.party = false;
    }
    // Coffee runs: each new face at the machine is one more cup poured.
    const here = new Set(hang.filter((h) => h.kind === 'coffee').map((h) => h.id));
    for (const h of hang) {
      if (h.kind !== 'coffee' || this.atCoffee.has(h.id)) continue;
      this.atCoffee.add(h.id);
      this.stats.coffees++;
      this.wander.say(h.id, pick(COFFEE));
    }
    for (const id of this.atCoffee) if (!here.has(id)) this.atCoffee.delete(id);
    if (this.atCoffee.size !== here.size) this.save();
  }
}
