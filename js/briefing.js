// Résumé du matin : rédigé une fois par jour par l'assistant, à partir des mêmes données que le chat.
import { state, update, local, appPassword } from './store.js';
import { icon } from './icons.js';
import { esc } from './text.js';
import { todayISO } from './dates.js';
import { callAssistantApi, buildContext, formatAnswer } from './assistant.js';

const PROMPT = `Rédige mon résumé du matin, en français, en 120 mots maximum, avec ces parties courtes :
**Aujourd'hui** : mes cours et événements du jour, avec les heures.
**Priorités** : les 3 tâches les plus importantes à faire aujourd'hui, en tenant compte des échéances et des priorités.
**À surveiller** : ce qui est en retard, les projets négligés et les relances du jour.
Termine par une phrase d'encouragement très courte. Si une partie est vide, dis-le en quelques mots. N'invente rien. N'utilise pas de tiret long.`;

const enabled = () => state.shared.prefs.briefing && Boolean(appPassword());

export async function makeBriefing({ force = false } = {}) {
  const b = state.briefing;
  const today = todayISO();
  if (!enabled() || b.loading || !navigator.onLine) return;
  if (!force && (b.date === today || new Date().getHours() < 5)) return;
  update((s) => { s.briefing.loading = true; s.briefing.error = ''; }, { silent: true });
  try {
    const name = state.shared.name || 'l\'utilisateur';
    const text = await callAssistantApi({
      kind: 'chat',
      system: `Tu es l'assistant personnel d'organisation de ${name}. Réponds en français, de façon brève et bienveillante. Base-toi uniquement sur ces données :\n\n${buildContext()}`,
      messages: [{ role: 'user', text: PROMPT }],
    });
    update((s) => { s.briefing = { date: today, text, loading: false, error: '' }; }, { silent: true });
  } catch (e) {
    update((s) => { s.briefing.loading = false; s.briefing.error = e.message; }, { silent: true });
  }
}

export function briefingCard() {
  if (!enabled()) return '';
  const b = state.briefing;
  const today = todayISO();
  if (b.loading) {
    return `<section class="card briefing loading-card">${icon('sparkles')}<div><strong>Ton résumé du matin arrive…</strong><div class="skeleton"><i></i><i></i><i></i></div></div></section>`;
  }
  if (b.date === today && b.text) {
    return `
    <details class="card briefing" open>
      <summary>${icon('sparkles')}<strong>Ton résumé du matin</strong><button class="icon-btn small" data-action="briefing-refresh" aria-label="Refaire le résumé">${icon('repeat')}</button></summary>
      <div class="briefing-body">${formatAnswer(b.text)}</div>
    </details>`;
  }
  if (b.error) {
    return `<section class="card briefing">${icon('alert')}<div><strong>Résumé du matin indisponible</strong><p class="fine">${esc(b.error)}</p></div><button class="btn small" data-action="briefing-refresh">Réessayer</button></section>`;
  }
  return '';
}

export const briefingHandlers = {
  'briefing-refresh': () => makeBriefing({ force: true }),
};
