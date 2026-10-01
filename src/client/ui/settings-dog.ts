// ⚙️ Settings' Office dog, under Building: its name, for everyone on the floor (see server/dog.ts).
import type { Net } from '../net';
import { store } from '../state';
import { DOG_NAME_MAX, cleanDogName } from '../../shared/dog';
import { h } from './dom';
import { L } from '../i18n';

/** The setting, made by `frame` from what goes in it, and how to paint it afresh when the dog changes. */
export function dogSetting(net: Net, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; paint: () => void } {
  const dogInput = h('input', { type: 'text', maxlength: DOG_NAME_MAX, 'aria-label': L.settings.dogName, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dogSave = h('button.btn.primary', { type: 'button' }, L.settings.rename);
  const dogNote = h('p.setting-note');
  const dogSection = frame([h('div.webhook', {}, dogInput, dogSave), dogNote]);
  const paintDog = () => {
    const dog = store.dog;
    dogSection.classList.toggle('hidden', !dog);
    if (!dog) return;
    dogInput.placeholder = dog.name;
    dogNote.textContent = L.settings.dogNote(dog.name);
  };
  paintDog();
  const renameDog = () => {
    const name = cleanDogName(dogInput.value);
    if (!name) return dogInput.focus();
    net.send({ t: 'dog.name', name });
    dogInput.value = '';
  };
  dogSave.addEventListener('click', renameDog);
  dogInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameDog();
  });

  return { section: dogSection, paint: paintDog };
}
