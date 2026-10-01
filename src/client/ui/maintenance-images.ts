import type { MaintenanceAttachment } from '../../shared/protocol';
import { h } from './dom';

export const imageUrl = (id: string) => `/api/maintenance/image?id=${encodeURIComponent(id)}`;
export function imageEvidence(images: MaintenanceAttachment[]) {
  return h('div.maintenance-images', {}, ...images.map(image => h('a', { href: imageUrl(image.id), target: '_blank', rel: 'noopener noreferrer', title: image.name }, h('img', { src: imageUrl(image.id), alt: image.name, loading: 'lazy' }))));
}

/** Upload before sending so draft screenshots also survive closing the workspace. */
export function imageComposer(onChange: () => void, onError: (message: string) => void) {
  let images: MaintenanceAttachment[] = [];
  let uploading = 0;
  let disabled = false;
  const previews = h('div.maintenance-image-drafts');
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, class: 'hidden', 'aria-label': 'Choose screenshots' });
  const attach = h('button', { type: 'button', onclick: () => file.click() }, 'Attach images');
  const status = h('span.maintenance-upload-status', { 'aria-live': 'polite' });
  const element = h('div.maintenance-image-composer', {}, previews, h('div', {}, attach, status), file);
  const draw = () => {
    status.textContent = uploading ? `Uploading ${uploading}…` : images.length ? `${images.length}/4 · paste or drop more images` : 'Paste or drop screenshots · up to 4 × 10 MB';
    attach.disabled = disabled || uploading > 0 || images.length >= 4;
    previews.replaceChildren(...images.map(image => h('div', {}, h('img', { src: imageUrl(image.id), alt: image.name }), h('button', { type: 'button', disabled, 'aria-label': `Remove ${image.name}`, onclick: () => { images = images.filter(i => i.id !== image.id); draw(); onChange(); } }, '✕'))));
  };
  const add = async (files: File[]) => {
    if (disabled) return;
    for (const f of files) {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.type) || f.size > 10 * 1024 * 1024) { onError('Use PNG, JPEG, WebP or GIF screenshots up to 10 MB.'); continue; }
      if (images.length + uploading >= 4) { onError('Attach up to four images per request.'); break; }
      uploading++; draw(); onChange();
      try {
        const res = await fetch(`/api/maintenance/image?name=${encodeURIComponent(f.name || 'screenshot')}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': f.type }, body: f });
        const image = await res.json();
        if (!res.ok) throw new Error(image.error ?? 'Image upload failed');
        images.push(image);
      } catch (err) { onError((err as Error).message); }
      finally { uploading--; draw(); onChange(); }
    }
  };
  file.addEventListener('change', () => { void add([...file.files ?? []]); file.value = ''; });
  draw();
  return {
    element, get images() { return images; }, get uploading() { return uploading > 0; },
    set(value: MaintenanceAttachment[]) { images = value.slice(0, 4); draw(); },
    disable(value: boolean) { if (disabled !== value) { disabled = value; draw(); } },
    bind(target: HTMLElement) {
      target.addEventListener('paste', e => { const files = [...e.clipboardData?.files ?? []]; if (files.length) { e.preventDefault(); void add(files); } });
      target.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
      target.addEventListener('drop', e => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); void add([...e.dataTransfer.files]); });
    },
  };
}
