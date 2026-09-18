/**
 * El historial de precios que el bot va dejando en `history/prices-AAAA.csv`.
 *
 * Módulo PURO: el parseo y el recorte se prueban enteros sin tocar la red.
 *
 * Cada ejecución del cron añade una fila por activo, así que la serie son
 * puntos discretos y desiguales: si GitHub se salta un cron, hay un hueco. Por
 * eso el gráfico dibuja el tiempo a escala real y no un punto por muestra —
 * dibujar los huecos como si no existieran convertiría una pausa de seis horas
 * en una línea recta que parece un mercado tranquilo.
 */

export type PuntoHistorial = { t: number; precio: number };

const CABECERA = "timestamp,asset_id,provider,price,currency";

/**
 * Agrupa el CSV por activo.
 *
 * Tolerante a propósito: una fila ilegible se salta en vez de tumbar el panel.
 * Este fichero lo escribe un proceso automático en cada ejecución, y una línea
 * a medio escribir no puede costar la página entera.
 */
export function leerHistorial(csv: string, maxPuntos = 120): Record<string, PuntoHistorial[]> {
  const salida: Record<string, PuntoHistorial[]> = {};
  if (!csv.trim()) return salida;

  for (const linea of csv.split("\n")) {
    const fila = linea.trim();
    if (!fila || fila === CABECERA || fila.startsWith("timestamp,")) continue;

    const [marca, id, , precio] = fila.split(",");
    if (!marca || !id || !precio) continue;

    const t = Date.parse(marca);
    const valor = Number(precio);
    if (!Number.isFinite(t) || !Number.isFinite(valor) || valor <= 0) continue;

    (salida[id] ??= []).push({ t, precio: valor });
  }

  for (const id of Object.keys(salida)) {
    salida[id].sort((a, b) => a.t - b.t);
    // Los últimos N: la tarjeta enseña la forma reciente, no el año entero.
    if (salida[id].length > maxPuntos) salida[id] = salida[id].slice(-maxPuntos);
  }
  return salida;
}

/** El año del fichero que toca leer. El bot parte el historial por años. */
export function ficheroDelAno(fecha: Date = new Date()): string {
  return `history/prices-${fecha.getUTCFullYear()}.csv`;
}
