/**
 * Qué hace un precio, en números que sirven para decidir un umbral.
 *
 * Módulo PURO: no hace red, no lee el reloj, no importa nada del servidor. Todo
 * lo que decide qué umbral proponer vive aquí y se puede probar entero.
 *
 * El problema que resuelve: «0,0010» y «0,0015» parecen casi lo mismo, pero en
 * una moneda son un 50 % de diferencia, y en otra es el ruido de una tarde. Sin
 * saber cuánto se mueve NORMALMENTE ese activo, poner un umbral es adivinar.
 */

export type Punto = { t: number; precio: number };

const DIA_MS = 24 * 60 * 60 * 1000;

export type Perfil = {
  actual: number;
  minimo: number;
  maximo: number;
  /** Variación entre el primer y el último punto de la ventana, en %. */
  cambioVentana: number;
  /** Mediana del movimiento absoluto en 24 h: lo que hace un día cualquiera. */
  diaTipico: number;
  /** Percentil 90: un día movido, de los que hay uno por semana larga. */
  diaFuerte: number;
  /** Dónde cae el precio de ahora dentro del rango de la ventana, 0–100. */
  posicion: number;
  dias: number;
  puntos: number;
};

/** Ordena, descarta basura y deja la serie lista para medir. */
export function limpiar(serie: Punto[]): Punto[] {
  return serie
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.precio) && p.precio > 0)
    .sort((a, b) => a.t - b.t);
}

/** Variaciones porcentuales a 24 h vista, en valor absoluto.
 *
 *  Se busca el punto anterior POR TIEMPO, no por posición en el array: la serie
 *  puede venir horaria, cada 5 minutos o con huecos, y contar índices daría una
 *  ventana distinta en cada caso sin avisar. */
export function movimientosDiarios(serie: Punto[]): number[] {
  const salida: number[] = [];
  let j = 0;
  for (let i = 0; i < serie.length; i++) {
    const objetivo = serie[i].t - DIA_MS;
    if (serie[0].t > objetivo) continue; // aún no hay 24 h de historia
    while (j + 1 < serie.length && serie[j + 1].t <= objetivo) j++;
    const antes = serie[j].precio;
    if (antes > 0) salida.push(Math.abs((serie[i].precio - antes) / antes) * 100);
  }
  return salida;
}

/** Percentil por interpolación lineal. `p` va de 0 a 100. */
export function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  if (orden.length === 1) return orden[0];
  const pos = ((orden.length - 1) * p) / 100;
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (bajo === alto) return orden[bajo];
  return orden[bajo] + (orden[alto] - orden[bajo]) * (pos - bajo);
}

export function perfilar(entrada: Punto[]): Perfil | null {
  const serie = limpiar(entrada);
  if (serie.length < 2) return null;

  const precios = serie.map((p) => p.precio);
  const minimo = Math.min(...precios);
  const maximo = Math.max(...precios);
  const actual = precios[precios.length - 1];
  const primero = precios[0];

  const movimientos = movimientosDiarios(serie);

  return {
    actual,
    minimo,
    maximo,
    cambioVentana: ((actual - primero) / primero) * 100,
    diaTipico: percentil(movimientos, 50),
    diaFuerte: percentil(movimientos, 90),
    posicion: maximo === minimo ? 50 : ((actual - minimo) / (maximo - minimo)) * 100,
    dias: (serie[serie.length - 1].t - serie[0].t) / DIA_MS,
    puntos: serie.length,
  };
}

/**
 * Redondeo a cifras significativas.
 *
 * Un umbral de «0,07396078» no lo teclea nadie y da una falsa sensación de
 * precisión; «0,074» dice lo mismo. Y con cifras significativas en vez de
 * decimales fijos funciona igual para BTC (76.000) que para una memecoin
 * (0,00000123), que es justo donde redondear a dos decimales daría cero.
 */
export function redondear(valor: number, significativas = 3): number {
  if (!Number.isFinite(valor) || valor === 0) return 0;
  const magnitud = Math.floor(Math.log10(Math.abs(valor)));
  const factor = 10 ** (significativas - 1 - magnitud);
  return Math.round(valor * factor) / factor;
}

export type Sugerencia = { lower: number; upper: number; margenPct: number };

/**
 * Umbrales propuestos a partir de lo que el activo hace de verdad.
 *
 * El margen es el percentil 90 del movimiento diario: un salto de los que
 * ocurren aproximadamente una vez por semana. Ni tan estrecho que suene cada
 * tarde, ni tan ancho que no suene nunca.
 *
 * Con un suelo del 3 %: en un activo muy plano el p90 puede ser 0,4 %, y avisar
 * por eso es avisar por ruido.
 */
export function sugerir(perfil: Perfil, minimoPct = 3): Sugerencia {
  const margenPct = Math.max(perfil.diaFuerte, minimoPct);
  return {
    lower: redondear(perfil.actual * (1 - margenPct / 100)),
    upper: redondear(perfil.actual * (1 + margenPct / 100)),
    margenPct,
  };
}

// ── Simulación ────────────────────────────────────────────────────────────────

type Zona = "below" | "inside" | "above";

/** Misma regla que `classify()` del bot, histéresis incluida. Si esto se
 *  separa de aquello, el panel promete avisos que el bot no dará. */
export function clasificar(
  precio: number,
  lower: number | null,
  upper: number | null,
  previa: Zona | null,
  histeresisPct: number,
): Zona {
  const h = histeresisPct / 100;
  if (lower !== null && precio < lower) return "below";
  if (upper !== null && precio > upper) return "above";
  if (previa === "below" && lower !== null && precio < lower * (1 + h)) return "below";
  if (previa === "above" && upper !== null && precio > upper * (1 - h)) return "above";
  return "inside";
}

export type Opciones = {
  histeresisPct?: number;
  cooldownMinutos?: number;
  avisarAlVolver?: boolean;
  /** Anunciar un cruce que se deshizo antes de poder avisarlo. */
  avisarCruceBreve?: boolean;
  /** Avisar al empezar si el precio ya nace fuera del rango. */
  avisarAlEmpezar?: boolean;
};

type Clase = "breach" | "recover";

/**
 * Cuántos avisos habrías recibido con estos umbrales durante esta ventana.
 *
 * Es el dato que convierte un umbral abstracto en una decisión: «te habría
 * avisado 14 veces» significa que está demasiado cerca, y para entenderlo no
 * hace falta saber nada de volatilidad.
 *
 * Sigue al motor del bot paso por paso, y eso incluye cuatro reglas que una
 * aproximación razonable se salta y que cambian la cuenta:
 *
 *  1. Ruptura y recuperación llevan RELOJES SEPARADOS. El silencio de una no
 *     puede tragarse el aviso de la otra.
 *  2. Un cruce retenido por el silencio queda pendiente, pero si mientras tanto
 *     el precio se mueve otra vez, el pendiente se DESCARTA: no se entrega
 *     además del nuevo.
 *  3. Un cruce completo (de un extremo al otro entre dos consultas) ignora el
 *     silencio: es demasiado informativo para callarlo.
 *  4. Un cruce que se deshace antes de anunciarse no avisa de nada, ni siquiera
 *     de la vuelta al rango: nadie se enteró de la ruptura.
 *
 * Si esto se separa del bot, el panel promete avisos que luego no llegan, que
 * es peor que no decir nada.
 */
export function simular(
  entrada: Punto[],
  lower: number | null,
  upper: number | null,
  opciones: Opciones = {},
): number {
  const {
    histeresisPct = 0.25,
    cooldownMinutos = 180,
    avisarAlVolver = true,
    avisarCruceBreve = false,
    avisarAlEmpezar = true,
  } = opciones;

  const serie = limpiar(entrada);
  if (serie.length < 2 || (lower === null && upper === null)) return 0;

  const cooldownMs = cooldownMinutos * 60 * 1000;
  const ultimo: Record<Clase, number | null> = { breach: null, recover: null };
  let avisos = 0;
  let pendiente: Clase | null = null;

  const silencioVencido = (clase: Clase, t: number) =>
    ultimo[clase] === null || t - (ultimo[clase] as number) >= cooldownMs;
  const anotar = (clase: Clase, t: number) => {
    avisos++;
    ultimo[clase] = t;
    pendiente = null;
  };

  let zona = clasificar(serie[0].precio, lower, upper, null, histeresisPct);

  // Arranque en frío: si el precio ya nacía fuera del rango, el bot lo dice en
  // la primera consulta. Cuenta, porque es un aviso que habrías recibido.
  if (zona !== "inside" && avisarAlEmpezar) anotar("breach", serie[0].t);

  for (let i = 1; i < serie.length; i++) {
    const { t, precio } = serie[i];
    const nueva = clasificar(precio, lower, upper, zona, histeresisPct);

    if (nueva === zona) {
      // Misma zona: aquí solo puede salir un pendiente que ya venció.
      if (pendiente !== null && silencioVencido(pendiente, t)) anotar(pendiente, t);
      continue;
    }

    const anterior = zona;
    zona = nueva;
    const clase: Clase = nueva === "inside" ? "recover" : "breach";

    // Cruce breve: rompió y volvió sin que nadie se enterara.
    if (nueva === "inside" && pendiente === "breach") {
      if (avisarCruceBreve) anotar("recover", t);
      else pendiente = null;
      continue;
    }

    if (nueva === "inside" && !avisarAlVolver) {
      pendiente = null;
      continue;
    }

    const cruceCompleto = anterior !== "inside" && nueva !== "inside";
    if (cruceCompleto || silencioVencido(clase, t)) anotar(clase, t);
    else pendiente = clase;
  }

  return avisos;
}
