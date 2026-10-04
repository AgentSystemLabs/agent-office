// ⚙️ Settings' Office dog, under Building: its name, and its breed and coat as buttons, for everyone
// on the floor (see server/dog.ts).
import type { Net } from '../net';
import { store } from '../state';
import { DOG_BREEDS, DOG_BREED_NAMES, DOG_COATS, DOG_COAT_NAMES, DOG_NAME_MAX, cleanDogName, dogBreed } from '../../shared/dog';
import { h } from './dom';

/** The setting, made by `frame` from what goes in it, and how to paint it afresh when the dog changes. */
export function dogSetting(net: Net, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; paint: () => void } {
  const dogInput = h('input', { type: 'text', maxlength: DOG_NAME_MAX, 'aria-label': "강아지 이름", spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dogSave = h('button.btn.primary', { type: 'button' }, "이름 변경");
  const dogNote = h('p.setting-note');
  const breedRow = h('div.seg', { role: 'radiogroup', 'aria-label': "품종" });
  const coatRow = h('div.swatches', { role: 'radiogroup', 'aria-label': "털 색상" });
  const dogSection = frame([h('div.webhook', {}, dogInput, dogSave), breedRow, coatRow, dogNote]);
  const paintDog = () => {
    const dog = store.dog;
    dogSection.classList.toggle('hidden', !dog);
    if (!dog) return;
    dogInput.placeholder = dog.name;
    dogNote.textContent = `${dog.name}은(는) 이 층의 강아지입니다. 직원이 응답을 기다리면 ${dog.name}이(가) 해당 책상으로 달려가 짖습니다. 앞에서 E를 누르면 쓰다듬을 수 있습니다. 이름, 품종, 털 색상은 같은 층의 모든 참여자에게 적용됩니다.`;
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
          DOG_BREED_NAMES[b],
        ),
      ),
    );
    coatRow.replaceChildren(
      ...DOG_COATS.map(([body, light], i) =>
        h('button.swatch', {
          type: 'button',
          role: 'radio',
          title: DOG_COAT_NAMES[i],
          'aria-label': DOG_COAT_NAMES[i],
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
