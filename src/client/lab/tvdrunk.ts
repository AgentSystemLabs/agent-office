// A lab page for checking the drunk effect on the TV's picture by eye (Vite dev only, it isn't
// built: http://localhost:5173/lab/tvdrunk.html). It builds the real frame and hangs the real
// DrunkPicture on it, and puts a video in from another origin, so what it shows is what a player
// on the wall looks like. window.setDrunk(amount) sets how drunk, window.setTime(t) where the
// clock is, so the wobble can be stepped frame by frame.
//
// It isn't in vite.config.ts's build input: like the other lab pages it's a dev tool only.

import { DrunkPicture } from '../drunkframe';
import { ready } from './stage';

const frame = document.querySelector<HTMLElement>('.tv-frame')!;
const picture = new DrunkPicture(frame);

// A cross-origin player, because that is the whole point: an iframe the office can't read the
// pixels of, which is why the effect is a filter and not a texture.
const iframe = document.createElement('iframe');
iframe.src = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1&controls=0';
iframe.width = '1280';
iframe.height = '720';
iframe.title = 'Office TV';
frame.append(iframe);

/** How drunk, and where the clock is: stepped by the screenshot helper to catch one pose. */
let amount = 0;
let t = 0;
function draw() {
  picture.apply(amount, t, true);
}
(window as unknown as { setDrunk: (a: number) => void }).setDrunk = (a: number) => {
  amount = a;
  draw();
};
(window as unknown as { setTime: (v: number) => void }).setTime = (v: number) => {
  t = v;
  draw();
};
draw();

ready({
  filter: frame.style.filter,
  corners: getComputedStyle(frame).getPropertyValue('--drunk').trim(),
  // The bezel behind it, so a spill past the picture's own edges would show.
  spill: getComputedStyle(document.getElementById('bezel')!).backgroundColor,
});
