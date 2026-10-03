import * as THREE from 'three';
import { FPS, moveFps, type FpsInput, type FpsPlayer, type FpsState } from '../../../shared/fps';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { closeAllModals, h, modalOpen, openModal, toast, type Modal } from '../../ui/dom';
import { FpsWorld } from './world';
import { FpsHud, openFpsLobby } from './ui';
import { impactKind } from './impact';
import { FpsPreferences } from './preferences';
import type { BotOptions } from '../../../shared/fps-bots';

export function installFps(ctx: Ctx) {
  let wanted = false, active = false, state: FpsState | null = null, local: FpsPlayer | null = null;
  let arena: FpsWorld | null = null, pauseModal: Modal | null = null;
  let previousView = ctx.player.view, previousClick = ctx.player.onClick;
  let savedYaw = 0, savedPitch = 0, lastSend = 0, receivedAt = 0;
  let savedSensitivity = ctx.player.lookSensitivity;
  const preferences = new FpsPreferences();
  const sensitivity = (value: number) => { if (active) ctx.player.lookSensitivity = value; };
  let fire = false, roundKey = '', reloadWas = false;
  const held = new Set<string>(), correction = new THREE.Vector3();
  const hud = new FpsHud(pause);
  const join = (bot?: BotOptions) => {
    if (!ctx.net.up) return toast('办公室连接已断开，请等待重连。', 'warn');
    wanted = true; ctx.net.send(bot ? { t: 'fps.practice', bot } : { t: 'fps.join' });
  };
  const lobby = () => openFpsLobby(() => join(), bot => join(bot), preferences, sensitivity);
  const entry = h('button.fps-entry', { type: 'button', onclick: lobby }, 'FPS · 1V1  /  F8');
  ctx.keys.bind({ code: 'F8', preventDefault: true, repeat: false, run: () => { lobby(); } });
  ctx.canvas.parentElement!.append(entry);

  function input(): FpsInput {
    const enabled = !modalOpen() && document.hasFocus() && !document.hidden && ctx.player.hasMouse;
    return { forward: enabled ? Number(held.has('KeyW')) - Number(held.has('KeyS')) : 0,
      side: enabled ? Number(held.has('KeyD')) - Number(held.has('KeyA')) : 0,
      yaw: Math.atan2(Math.sin(ctx.player.camYaw), Math.cos(ctx.player.camYaw)), pitch: THREE.MathUtils.clamp(ctx.player.lookPitch, -1.45, 1.45),
      walk: held.has('ShiftLeft') || held.has('ShiftRight'), jump: enabled && held.has('Space'), fire: enabled && fire };
  }

  function clear() { held.clear(); fire = false; if (active) ctx.net.send({ t: 'fps.input', input: { ...input(), forward: 0, side: 0, jump: false, fire: false } }); }

  function enter() {
    closeAllModals(); ctx.activities.stopAll('start'); ctx.player.stopWalking();
    previousView = ctx.player.view; previousClick = ctx.player.onClick;
    savedYaw = ctx.player.camYaw; savedPitch = ctx.player.lookPitch;
    savedSensitivity = ctx.player.lookSensitivity; ctx.player.lookSensitivity = preferences.sensitivity;
    ctx.player.stand(); ctx.player.setView('first'); ctx.player.clearKeys();
    ctx.player.onClick = () => {}; ctx.player.rig = () => { ctx.player.moving = false; };
    arena ??= new FpsWorld(); active = true; document.body.classList.add('fps-active');
    ctx.player.lock(); ctx.net.send({ t: 'doing', what: 'FPS 对战' });
  }

  function leave(send = true) {
    wanted = false;
    if (!active) return;
    clear(); active = false; state = null; local = null; roundKey = ''; reloadWas = false;
    arena?.clearShots();
    pauseModal?.close(); pauseModal = null;
    if (send) ctx.net.send({ t: 'fps.leave' });
    ctx.player.rig = null; ctx.player.onClick = previousClick; ctx.player.setView(previousView);
    ctx.player.camYaw = savedYaw; ctx.player.lookPitch = savedPitch;
    ctx.player.lookSensitivity = savedSensitivity;
    ctx.player.enabled = !modalOpen(); ctx.player.clearKeys(); ctx.player.updateCamera(true);
    document.body.classList.remove('fps-active'); hud.hide();
    ctx.net.send({ t: 'doing' }); ctx.hint.invalidate();
    if (!modalOpen()) ctx.player.lock();
  }

  function pause() {
    if (!active || pauseModal || modalOpen()) return;
    clear();
    const content = h('div.fps-dialog-content', {}, h('div.fps-eyebrow', {}, 'OFFICE / STRIKE'),
      h('p', {}, '比赛计时继续。关闭此窗口将返回瞄准。'),
      preferences.control(sensitivity),
      h('button.btn.primary.fps-join', { onclick: () => pauseModal?.close() }, '返回竞技场'),
      h('button.btn', { onclick: () => leave() }, '退出对战，返回办公室'));
    const opponent = state?.players.find(p => p.bot);
    if (opponent?.bot && opponent.difficulty) {
      const bot = preferences.botControl({ profile: opponent.bot, difficulty: opponent.difficulty });
      content.append(bot.root, h('button.btn.fps-apply-bot', { onclick: () => ctx.net.send({ t: 'fps.bot', bot: bot.options() }) }, '应用人机设置'));
    }
    if (state?.phase === 'finished') content.append(h('button.btn', { onclick: () => { ctx.net.send({ t: 'fps.rematch' }); pauseModal?.close(); } }, opponent ? '再战一局' : '准备再战（双方确认）'));
    const panel = h('div.modal.fps-dialog', {}, h('header', {}, h('h2', {}, state?.phase === 'finished' ? '对决已结束' : '对战菜单')), content);
    pauseModal = openModal(panel, { doing: 'FPS 对战菜单', onClose: () => { pauseModal = null; clear(); } });
  }

  ctx.messages.on('fps.state', msg => {
    if (!wanted) return;
    const me = msg.state.players.find(p => p.id === store.you);
    if (!me) { leave(false); return; }
    if (!active) enter();
    state = msg.state; receivedAt = performance.now();
    const key = `${state.players.map(p => p.id).join(',')}/${state.round}/${state.phase === 'waiting' ? 'waiting' : 'match'}`;
    if (!local || key !== roundKey) {
      arena?.clearShots();
      local = { ...me }; correction.set(0, 0, 0); roundKey = key;
      ctx.player.camYaw = me.yaw; ctx.player.lookPitch = me.pitch; clear();
    } else {
      // Predict the shared movement locally, then ease toward the server's accepted position.
      correction.set(me.x - local.x, me.y - local.y, me.z - local.z);
      Object.assign(local, { hp: me.hp, ammo: me.ammo, reserve: me.reserve, vy: me.vy });
      if (correction.length() > 1) { Object.assign(local, { x: me.x, y: me.y, z: me.z }); correction.set(0, 0, 0); }
    }
    if (me.reloadUntil && !reloadWas) ctx.sound.fps('reload');
    reloadWas = !!me.reloadUntil;
  });
  ctx.messages.on('fps.shot', msg => {
    if (!active || !arena) return;
    const own = msg.shot.shooter === store.you;
    arena.shot(msg.shot, own);
    const at = (p: typeof msg.shot.from) => !local ? undefined : {
      x: ctx.player.pos.x + p.x - local.x, y: ctx.player.pos.y + p.y - local.y, z: ctx.player.pos.z + p.z - local.z };
    ctx.sound.fps('shot', own ? undefined : at(msg.shot.from));
    const kind = impactKind(msg.shot);
    if (msg.shot.hit) {
      ctx.sound.fps(msg.shot.headshot ? 'headshot' : 'hit', own ? undefined : at(msg.shot.to));
      if (own) hud.markHit(msg.shot.headshot);
      if (msg.shot.hit === store.you) ctx.sound.fps('hurt');
    } else if (kind === 'metal' || kind === 'wood' || kind === 'stone') {
      ctx.sound.fps(kind, at(msg.shot.to));
    }
  });
  ctx.net.onStatus(up => { if (!up && active) { leave(false); toast('连接中断，已退出对战。重连后可重新加入。', 'warn'); } });

  ctx.activities.add({ id: 'fps', active: () => active, hidesHands: true, bothHands: true, takesCamera: true, stop: () => leave() });
  ctx.keys.add('guard', e => {
    if (!active || modalOpen() || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.code === 'F8') { if (!e.repeat) { clear(); lobby(); } e.preventDefault(); return true; }
    if (e.code === 'Escape') { pause(); e.preventDefault(); return true; }
    if (e.code === 'KeyR' && !e.repeat) ctx.net.send({ t: 'fps.reload' });
    held.add(e.code); if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    return true;
  });
  window.addEventListener('keyup', e => held.delete(e.code));
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);
  ctx.windowOpened.add(clear);
  ctx.canvas.addEventListener('pointerdown', e => {
    if (active && !modalOpen() && e.button === 0 && ctx.player.hasMouse) fire = true;
  });
  window.addEventListener('pointerup', e => { if (e.button === 0) fire = false; });
  document.addEventListener('pointerlockchange', () => {
    if (active && !ctx.player.locked) clear();
  });

  ctx.view.add({ covers: () => active, fov: fov => active ? 78 : fov });
  ctx.ticks.add('render', () => {
      if (!arena || !active) return;
      const autoClear = ctx.renderer.autoClear;
      ctx.renderer.setRenderTarget(null); ctx.renderer.autoClear = true;
      ctx.renderer.render(arena.scene, ctx.camera); ctx.renderer.clearDepth();
      ctx.renderer.autoClear = false; ctx.renderer.render(arena.weaponScene, ctx.camera);
      ctx.renderer.autoClear = autoClear;
  });
  ctx.ticks.add('env', ({ dt, now }) => {
    if (!active || !state || !local || !arena) return;
    const controls = input();
    if (now - lastSend >= 33) { ctx.net.send({ t: 'fps.input', input: controls }); lastSend = now; }
    if (state.phase === 'live' && local.hp && now - receivedAt < 250) moveFps(local, controls, dt);
    const fraction = Math.min(1, dt * 10);
    local.x += correction.x * fraction; local.y += correction.y * fraction; local.z += correction.z * fraction; correction.multiplyScalar(1 - fraction);
    ctx.camera.position.set(local.x, local.y + FPS.eye, local.z);
    ctx.camera.rotation.set(ctx.player.lookPitch, ctx.player.camYaw, 0, 'YXZ'); ctx.camera.updateMatrixWorld();
    const me = state.players.find(p => p.id === store.you)!;
    const serverNow = state.now + now - receivedAt;
    arena.update(state.players.find(p => p.id !== store.you), ctx.camera, dt, me.reloadUntil > serverNow, !!(controls.side || controls.forward), ctx.reduceMotion.matches);
    hud.show(state, store.you, serverNow);
  });
  // Same read-only debug convention as __office, useful for two-browser integration checks.
  (window as any).__fps = { state: () => state, active: () => active, sounds: () => ({ ...ctx.sound.played }) };
}
