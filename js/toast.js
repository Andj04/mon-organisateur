// Petits messages éphémères en bas de l'écran, avec bouton "Annuler" si besoin.
import { undo } from './store.js';
import { esc } from './text.js';

export function toast(message, { action, undo: canUndo = false, duration = 4000 } = {}) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  box.querySelectorAll('.toast').forEach((t) => t.remove());
  box.appendChild(el);
  const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('button')?.addEventListener('click', () => { if (canUndo) undo(); remove(); });
  setTimeout(remove, duration);
}
