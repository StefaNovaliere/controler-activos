/** Formateo para personas. Nada de esto se guarda: el YAML lleva siempre el
 *  valor canónico con punto decimal. */

export function money(value: string | number | null | undefined, currency?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);

  // Los pares de divisas se mueven en el cuarto decimal: redondear a dos
  // borraría justo el dígito que importa.
  const decimals = Math.abs(number) >= 1000 ? 2 : Math.abs(number) >= 1 ? 4 : 8;
  const text = new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: Math.abs(number) >= 1000 ? 2 : 0,
  }).format(number);
  return currency ? `${text} ${currency.toUpperCase()}` : text;
}

export function percent(value: number): string {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(Math.abs(value))} %`;
}

/** Distancia del precio a un umbral, en porcentaje con signo. */
export function distanceTo(price: number, threshold: number): number {
  return ((threshold - price) / price) * 100;
}

/**
 * Antigüedad en palabras. Se formatea en el cliente: Vercel corre en UTC y
 * formatear una fecha en el servidor produciría desajuste de hidratación además
 * de enseñar una hora que no es la del usuario.
 */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "nunca";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "desconocido";

  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "hace unos segundos";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "hace 1 día" : `hace ${days} días`;
}

export function minutesSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  return Number.isFinite(then) ? (now - then) / 60000 : null;
}

export const ZONE_LABEL: Record<string, string> = {
  below: "por debajo",
  inside: "dentro del rango",
  above: "por encima",
};
