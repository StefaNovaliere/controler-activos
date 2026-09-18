/**
 * Cuánto poner en una operación.
 *
 * Módulo PURO. Casi nadie se funde por entrar mal: se funden por entrar GRANDE.
 * La cuenta que hay aquí es la diferencia entre sobrevivir a veinte memecoins
 * malas o no sobrevivir a la tercera, y cabe en cuatro líneas.
 *
 * La idea: decides cuánto estás dispuesto a perder si te equivocas (un % pequeño
 * de tu capital) y dónde admitirías estar equivocado (el stop). Esas dos cosas
 * determinan el tamaño; no al revés. Elegir primero el tamaño y luego «a ver
 * hasta dónde aguanto» es como se pierde el capital entero en tres intentos.
 */

export type Entrada = {
  capital: number;
  /** Porcentaje del capital que aceptas perder en ESTA operación. */
  riesgoPct: number;
  precioEntrada: number;
  /** El precio al que admitirías estar equivocado. */
  stop: number;
};

export type Tamano = {
  /** Lo que arriesgas de verdad, en dinero. */
  riesgoDinero: number;
  /** Cuánto cae el precio hasta el stop, en %. */
  distanciaPct: number;
  /** Cuánto dinero poner. */
  posicion: number;
  /** Cuántas unidades del activo. */
  cantidad: number;
  /** Qué parte de tu capital ocupa esa posición. */
  pesoPct: number;
  /** True si el capital, y no el riesgo, es lo que limita la posición. */
  limitadoPorCapital: boolean;
};

export function calcular({ capital, riesgoPct, precioEntrada, stop }: Entrada): Tamano | null {
  const valido =
    [capital, riesgoPct, precioEntrada, stop].every((n) => Number.isFinite(n) && n > 0) &&
    stop < precioEntrada;
  if (!valido) return null;

  const distancia = (precioEntrada - stop) / precioEntrada;
  const riesgoDinero = (capital * riesgoPct) / 100;
  const ideal = riesgoDinero / distancia;

  // Con un stop muy ancho —lo normal en una memecoin— la posición que sale de
  // la fórmula puede superar tu capital. Entonces el límite ya no es el riesgo
  // que elegiste sino lo que tienes, y el riesgo REAL es mayor que el 2 % que
  // pediste. Decirlo importa más que el número.
  const limitadoPorCapital = ideal > capital;
  const posicion = Math.min(ideal, capital);

  return {
    riesgoDinero: posicion * distancia,
    distanciaPct: distancia * 100,
    posicion,
    cantidad: posicion / precioEntrada,
    pesoPct: (posicion / capital) * 100,
    limitadoPorCapital,
  };
}
