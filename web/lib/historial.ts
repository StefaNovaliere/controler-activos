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
export function leerHistorial(csv: string, maxPuntos = 4000): Record<string, PuntoHistorial[]> {
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
    // Un tope alto solo para no cargar el año entero en memoria; el recorte de
    // verdad lo hace `desde()` según el rango que elija quien mira. Cuando este
    // tope era 120 y el cron pasó de 30 a 15 minutos, la ventana se encogió de
    // 2,5 días a 30 horas sin que nadie lo tocara: un número de puntos no dice
    // cuánto tiempo abarca.
    if (salida[id].length > maxPuntos) salida[id] = salida[id].slice(-maxPuntos);
  }
  return salida;
}

/** El año del fichero que toca leer. El bot parte el historial por años. */
export function ficheroDelAno(fecha: Date = new Date()): string {
  return `history/prices-${fecha.getUTCFullYear()}.csv`;
}


/** Los puntos de los últimos `ms` milisegundos. `null` no recorta nada. */
export function desde(puntos: PuntoHistorial[], ms: number | null, ahora = Date.now()): PuntoHistorial[] {
  if (ms === null) return puntos;
  const limite = ahora - ms;
  return puntos.filter((p) => p.t >= limite);
}

/**
 * Reduce la serie conservando la FORMA.
 *
 * Quedarse con uno de cada N es lo rápido y lo equivocado: un pico que dure una
 * sola muestra desaparece, y justo los picos son lo que se está mirando. Aquí se
 * parte la serie en tramos y de cada uno sobreviven el mínimo y el máximo, así
 * que la envolvente del dibujo es la real por mucho que se reduzca.
 *
 * Hace falta porque un mes a un punto cada 15 minutos son ~2900 puntos para
 * dibujar en 260 píxeles: once por píxel, que abultan el HTML sin añadir nada.
 */
export function submuestrear(puntos: PuntoHistorial[], objetivo: number): PuntoHistorial[] {
  if (objetivo < 2 || puntos.length <= objetivo) return puntos;

  const tramos = Math.floor(objetivo / 2);
  const ancho = puntos.length / tramos;
  const salida: PuntoHistorial[] = [];

  for (let i = 0; i < tramos; i++) {
    const trozo = puntos.slice(Math.floor(i * ancho), Math.floor((i + 1) * ancho));
    if (trozo.length === 0) continue;

    let min = trozo[0];
    let max = trozo[0];
    for (const p of trozo) {
      if (p.precio < min.precio) min = p;
      if (p.precio > max.precio) max = p;
    }
    // En orden temporal, o la línea iría y volvería dentro del mismo tramo.
    if (min.t === max.t) salida.push(min);
    else salida.push(min.t < max.t ? min : max, min.t < max.t ? max : min);
  }

  // El último punto es el precio de ahora: no puede perderse por redondeo.
  const ultimo = puntos[puntos.length - 1];
  if (salida.length === 0 || salida[salida.length - 1].t !== ultimo.t) salida.push(ultimo);
  return salida;
}

/** Los rangos que se ofrecen, en el orden en que se leen. */
export const RANGOS = [
  { clave: "24h", etiqueta: "24 h", ms: 24 * 60 * 60 * 1000 },
  { clave: "7d", etiqueta: "7 días", ms: 7 * 24 * 60 * 60 * 1000 },
  { clave: "30d", etiqueta: "30 días", ms: 30 * 24 * 60 * 60 * 1000 },
  { clave: "todo", etiqueta: "Todo", ms: null },
] as const;

export type ClaveRango = (typeof RANGOS)[number]["clave"];

export function rangoPorClave(clave: string): number | null {
  return RANGOS.find((r) => r.clave === clave)?.ms ?? RANGOS[1].ms;
}
