import { ARENA, FPS, type FpsPlayer, type FpsState } from '../../../shared/fps';
import { h, openModal, type Modal } from '../../ui/dom';
import './ui.css';

export function openFpsLobby(join: () => void): Modal {
  let modal: Modal;
  const panel = h('div.modal.fps-dialog', {},
    h('div.fps-eyebrow', {}, 'OFFICE / STRIKE'), h('h2', {}, '双人战术对决'),
    h('p', {}, '进入训练码头，与同一办公室服务器中的另一位玩家对战。'),
    h('div.fps-rules', {}, h('strong', {}, '1 vs 1'), h('span', {}, '先赢 5 回合'), h('span', {}, '每回合 90 秒')),
    h('p', {}, '双方配备步枪、100 生命值和 30 发弹匣。利用集装箱绕侧，击败对手；每回合重置补给并交换出生点。'),
    h('div.fps-controls', {}, 'WASD 移动 · Shift 静步 · Space 跳跃', h('br'), '鼠标瞄准 · 左键射击 · R 换弹 · Esc 暂停'),
    h('button.btn.primary.fps-join', { onclick: () => { modal.close(); join(); } }, '加入竞技场 →'),
    h('small', {}, '两位玩家需打开同一服务器的办公室，分别点击 FPS。'));
  modal = openModal(panel, { doing: 'FPS 对战大厅' }); return modal;
}

export class FpsHud {
  readonly root = h('div.fps-hud');
  private title = h('div.fps-round');
  private left = h('div.fps-team.blue');
  private right = h('div.fps-team.orange');
  private clock = h('div.fps-clock');
  private banner = h('div.fps-banner');
  private hp = h('div.fps-health');
  private ammo = h('div.fps-ammo');
  private hit = h('div.fps-hit', {}, '×');
  private radar = h('canvas.fps-radar', { width: 192, height: 144, 'aria-label': '竞技场地图与自身位置' });
  private lastHp = 100;
  private hitUntil = 0;
  private damageUntil = 0;

  constructor(pause: () => void) {
    this.root.append(h('div.fps-brand', {}, 'OFFICE', h('strong', {}, 'STRIKE'), h('small', {}, 'TRAINING FACILITY / 01')), this.radar,
      h('div.fps-score', {}, this.left, h('div', {}, this.title, this.clock), this.right),
      h('button.fps-pause', { onclick: pause, 'aria-label': '暂停对战' }, '暂停  ESC'),
      h('div.fps-crosshair', {}, h('i'), h('i'), h('i'), h('i')), this.hit, this.banner,
      h('div.fps-bottom', {}, this.hp, h('div.fps-loadout', {}, '01 / ASSAULT', h('strong', {}, 'AR-30'), h('small', {}, '左键 射击  /  R 换弹')), this.ammo),
      h('div.fps-keyguide', {}, 'WASD 移动　SHIFT 静步　SPACE 跳跃　ESC 暂停'));
    document.body.append(this.root); this.root.hidden = true;
  }

  show(state: FpsState, you: string, now: number) {
    const me = state.players.find(p => p.id === you), opponent = state.players.find(p => p.id !== you);
    if (!me) return;
    this.root.hidden = false;
    this.title.textContent = `ROUND ${String(Math.max(1, state.round)).padStart(2, '0')} · FIRST TO ${FPS.wins}`;
    this.left.replaceChildren(h('span', {}, me.name), h('strong', {}, me.score));
    this.right.replaceChildren(h('strong', {}, opponent?.score ?? '—'), h('span', {}, opponent?.name ?? '等待对手'));
    const seconds = Math.max(0, Math.ceil((state.until - now) / 1000));
    this.clock.textContent = state.phase === 'live' ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : state.phase === 'finished' ? 'FINAL' : '1 V 1';
    this.hp.replaceChildren(h('small', {}, 'HEALTH'), h('strong', {}, me.hp), h('div.fps-healthbar', { style: `--hp:${me.hp}%` }));
    this.ammo.replaceChildren(h('strong', {}, me.ammo), h('span', {}, `/ ${me.reserve}`), h('small', {}, me.reloadUntil > now ? '换弹中…' : me.ammo ? 'AMMO / 5.56' : '弹匣已空 · 按 R 换弹'));
    let heading = '', subtitle = '';
    if (state.phase === 'waiting') { heading = '等待另一位玩家'; subtitle = state.reason || '请朋友打开同一服务器，点击 FPS 并加入'; }
    if (state.phase === 'countdown') { heading = String(seconds); subtitle = '准备对战 · 本回合已补满弹药'; }
    if (state.phase === 'intermission') { heading = state.winner === you ? '回合胜利' : state.winner ? '回合失利' : '回合平局'; subtitle = `${state.reason} · ${seconds} 秒后交换出生点`; }
    if (state.phase === 'finished') { heading = state.winner === you ? '对决胜利' : '对决结束'; subtitle = `最终比分 ${me.score} : ${opponent?.score} · ${me.ready ? '已准备，等待对手' : 'Esc 可再战或退出'}`; }
    this.banner.replaceChildren(h('strong', {}, heading), h('span', {}, subtitle)); this.banner.hidden = !heading;
    if (me.hp < this.lastHp) this.damageUntil = performance.now() + 220;
    this.lastHp = me.hp;
    this.root.classList.toggle('damaged', performance.now() < this.damageUntil);
    this.hit.hidden = performance.now() > this.hitUntil;
    this.map(me);
  }

  markHit() { this.hitUntil = performance.now() + 200; }
  hide() { this.root.hidden = true; this.lastHp = 100; }

  private map(me: FpsPlayer) {
    const c = this.radar.getContext('2d')!; c.clearRect(0, 0, 192, 144); c.fillStyle = '#17252bd9'; c.fillRect(0, 0, 192, 144);
    c.fillStyle = '#60717b'; for (const b of ARENA) c.fillRect((b.x - b.w / 2 + 16) * 6, (b.z - b.d / 2 + 12) * 6, b.w * 6, b.d * 6);
    c.save(); c.translate((me.x + 16) * 6, (me.z + 12) * 6); c.rotate(-me.yaw);
    c.fillStyle = '#7ce1fc'; c.beginPath(); c.moveTo(0, -6); c.lineTo(-4, 4); c.lineTo(4, 4); c.fill(); c.restore();
  }
}
