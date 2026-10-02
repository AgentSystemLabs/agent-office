// ⚙️ Settings' Office dog, under Building: its name, and its breed and coat as buttons, for everyone
// on the floor (see server/dog.ts).
import type { Net } from '../net';
import { store } from '../state';
import { DOG_BREEDS, DOG_COATS, DOG_NAME_MAX, cleanDogName, dogBreed } from '../../shared/dog';
import { h } from './dom';
import { L } from '../i18n';

/** The setting, made by `frame` from what goes in it, and how to paint it afresh when the dog changes. */
export function dogSetting(net: Net, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; paint: () => void } {
  const dogInput = h('input', { type: 'text', maxlength: DOG_NAME_MAX, 'aria-label': L.settings.dogName, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dogSave = h('button.btn.primary', { type: 'button' }, L.settings.rename);
  const dogNote = h('p.setting-note');
  const breedRow = h('div.seg', { role: 'radiogroup', 'aria-label': L.settings.dogBreed });
  const coatRow = h('div.swatches', { role: 'radiogroup', 'aria-label': L.settings.dogCoat });
  const dogSection = frame([h('div.webhook', {}, dogInput, dogSave), breedRow, coatRow, dogNote]);
  const paintDog = () => {
    const dog = store.dog;
    dogSection.classList.toggle('hidden', !dog);
    if (!dog) return;
    dogInput.placeholder = dog.name;
    dogNote.textContent = L.settings.dogNote(dog.name);
    const breed = dogBreed(dog.breed);
    breedRow.replaceChildren(
      ...DOG_BREEDS.map((b) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(b === breed),
            class: b === breed ? 'on' : '',
            onclick: () => b !== dogBreed(store.dog?.breed) && net.send({ t: 'dog.breed', breed: b }),
          },
          L.settings.dogBreeds[b],
        ),
      ),
    );
    coatRow.replaceChildren(
      ...DOG_COATS.map(([body, light], i) =>
        h('button.swatch', {
          type: 'button',
          role: 'radio',
          title: L.settings.dogCoats[i],
          'aria-label': L.settings.dogCoats[i],
          'aria-checked': String(i === dog.coat),
          class: i === dog.coat ? 'sel' : '',
          style: `background:linear-gradient(135deg, ${body} 55%, ${light} 55%)`,
          onclick: () => i !== store.dog?.coat && net.send({ t: 'dog.coat', coat: i }),
        }),
      ),
    );
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
