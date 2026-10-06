/**
 * A dónde volver después del login.
 *
 * Los enlaces de Telegram llevan a `/diario?activo=…&aviso=…`, y en el móvil se
 * abren casi siempre sin sesión. Sin esto, el login devolvía a la portada y el
 * activo y el aviso se perdían justo en el momento de anotar.
 *
 * Solo rutas INTERNAS: aceptar cualquier `next` sería un redirect abierto, un
 * enlace con el dominio del panel que, tras poner la contraseña, manda a otro
 * sitio. `//otro.com` y `/\otro.com` son absolutas para el navegador aunque
 * empiecen por barra.
 */
export function destinoSeguro(next: unknown): string {
  if (typeof next !== "string" || next.length > 500) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f\\]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}
