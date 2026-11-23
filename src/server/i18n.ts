// The few pages the server writes itself (service tunnels that are signed out, stopped or broken)
// speak the language the browser chose in the office. The office sets this cookie when the language
// changes; a first visit gets Spanish, like the rest of the interface.

import type { IncomingMessage } from 'node:http';
import { parseCookies } from './auth.js';

export type ServerLanguage = 'es' | 'en';

/** Shared with the browser's i18n module so the two halves agree on the cookie's name. */
export const LANGUAGE_COOKIE = 'agent-office-language';

/** Only English switches the server pages back; anything else (no cookie included) is Spanish. */
export function languageFromRequest(req: IncomingMessage | undefined): ServerLanguage {
  if (!req) return 'es';
  return parseCookies(req.headers.cookie)[LANGUAGE_COOKIE] === 'en' ? 'en' : 'es';
}

const ES: Record<string, string> = {
  'Not answering': 'No responde',
  'The server on port {port} (<code>{command}</code>) didn\'t answer. It may be restarting — try again in a moment.': 'El servidor del puerto {port} (<code>{command}</code>) no responde. Puede que se esté reiniciando: inténtalo de nuevo en un momento.',
  '🔒 Sign in to the office': '🔒 Inicia sesión en la oficina',
  "This is a worker's server on port {port}, reached through the office. Sign in with {how} to see it.": "Este es el servidor de un trabajador en el puerto {port}, al que se llega a través de la oficina. Inicia sesión con {how} para verlo.",
  'the office password': 'la contraseña de la oficina',
  'your name and password (or just the office password)': 'tu nombre y contraseña (o solo la contraseña de la oficina)',
  'your name and password': 'tu nombre y contraseña',
  'Your name (optional)': 'Tu nombre (opcional)',
  'Your name': 'Tu nombre',
  'Password': 'Contraseña',
  'Office password': 'Contraseña de la oficina',
  'Sign in': 'Iniciar sesión',
  'Sign-in failed': 'Error al iniciar sesión',
  'Could not reach the office': 'No se pudo conectar con la oficina',
  '💤 Not running': '💤 No en ejecución',
  'Nothing is serving port {port} right now. The worker may have stopped its server — check the 🌐 Services board in the office, or ask the worker to start it again.': 'Ahora mismo nada atiende el puerto {port}. Puede que el trabajador haya detenido su servidor: consulta el tablero 🌐 Servicios en la oficina o pídele que lo inicie de nuevo.',
};

/** Translate one of the server's page strings, filling `{placeholders}` where it needs to. */
export function s(lang: ServerLanguage, source: string, params: Record<string, string | number> = {}): string {
  let out = lang === 'es' ? ES[source] ?? source : source;
  for (const [key, value] of Object.entries(params)) out = out.replaceAll(`{${key}}`, String(value));
  return out;
}
