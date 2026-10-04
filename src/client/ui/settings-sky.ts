// ⚙️ Settings' Outside, under Building: what the sky's doing, and which clock it keeps, for everyone
// (see server/sky.ts).
import type { Net } from '../net';
import { store } from '../state';
import { h } from './dom';
import { describeSky } from '../world/sky';

/**
 * The setting, made by `frame` from what goes in it: the sky now (`outside`, see describeSky), the
 * real time of day or a whole day and night every hour as buttons, and a note. Kept up to date until `off`.
 */
export function outsideSetting(net: Net, outside: { now: string; live: boolean }, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': "하늘의 시간 흐름" });
  const now = h('p.outside-now');
  const note = h('p.setting-note');
  const paint = () => {
    const real = !!store.sky?.realTime;
    now.textContent = store.sky ? describeSky(store.sky) : outside.now;
    row.replaceChildren(
      ...[true, false].map((r) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(real === r),
            class: real === r ? 'on' : '',
            onclick: () => r !== !!store.sky?.realTime && net.send({ t: 'sky.clock', real: r }),
          },
          r ? "🕰️ 실제 시간 (24시간)" : "⏩ 1시간마다 하루",
        ),
      ),
    );
    note.textContent = `모두에게 같은 하늘이 보입니다: ${real ? "실제 시간에 맞춰 변화" : "1시간마다 낮과 밤이 반복"}, ${outside.live ? "현지의 실제 날씨." : "날씨가 수시로 바뀝니다. --city로 실행하면 실제 도시의 예보를 사용합니다."}`;
  };
  paint();
  return { section: frame([now, row, note]), off: store.on('sky', paint) };
}
