/**
 * El diario de operaciones: cada decisión con su motivo, escrito ANTES de saber
 * cómo salió.
 *
 * Módulo PURO: parseo, validación y estadísticas, sin red. Es la única pieza
 * del centinela que no produce señales sobre el mercado sino datos sobre
 * quien decide, y por eso la única que puede contestar si el resto sirve.
 *
 * Dos reglas de diseño que no son de gusto:
 *
 * 1. SIN MONTOS, por estructura. El repositorio es público, y el usuario eligió
 *    guardar aquí el diario a cambio de no publicar cantidades ni precios de
 *    entrada. No hay campo donde ponerlos: el precio de cada momento se DERIVA
 *    al mostrar, del historial que ya es público, y nunca se escribe.
 *
 * 2. PROCESO Y RESULTADO SE JUZGAN POR SEPARADO. Una decisión pésima puede
 *    salir bien y una excelente puede salir mal. Si se evalúa por resultado, el
 *    ruido educa: te enseña a repetir la suerte y a abandonar lo que estaba
 *    bien pensado. Por eso la revisión pregunta solo si la decisión fue buena
 *    con lo que se sabía entonces, y el resultado se enseña DESPUÉS.
 */

import type { PuntoHistorial } from "./historial";

export const DECISIONES = ["comprar", "vender", "mantener", "no-hacer-nada"] as const;
export type Decision = (typeof DECISIONES)[number];

export const JUICIOS = ["buena", "mala", "dudosa"] as const;
export type Juicio = (typeof JUICIOS)[number];

export const PLANES = ["si", "no", "sin-plan"] as const;
export type SiguioPlan = (typeof PLANES)[number];

export type Revision = { creado: string; juicio: Juicio; nota: string };

export type Entrada = {
  id: string;
  creado: string;
  /** Quién la escribió. No hay identidad —la contraseña es compartida—, así
   *  que es un nombre que cada uno pone y su navegador recuerda. */
  quien: string;
  activo: string;
  decision: Decision;
  /** Si nació de un aviso del centinela o de una idea propia. */
  origen: "aviso" | "propia";
  /** El tipo de aviso que la disparó, si vino de uno. */
  aviso?: string;
  motivo: string;
  siguioPlan: SiguioPlan;
  revision?: Revision;
};

/** Con menos entradas que esto, cualquier porcentaje es anécdota. */
export const ENTRADAS_MINIMAS = 30;

/** Horizonte fijo para medir el resultado. Fijo a propósito: medir contra
 *  «ahora» daría a las entradas viejas un plazo más largo que a las nuevas, y
 *  los aciertos dejarían de ser comparables entre sí. */
export const HORIZONTE_MS = 24 * 60 * 60 * 1000;

const MOTIVO_MINIMO = 15;
/** Topes: lo que entra se publica en el repositorio, y una Server Action se
 *  puede llamar a mano saltándose el formulario. */
export const MOTIVO_MAXIMO = 1000;
export const NOTA_MAXIMA = 500;
const QUIEN_MAXIMO = 40;
/** Forma de un tipo de evento del bot (BELOW_LOWER, TRAILING_DROP…). Viene de
 *  la URL del aviso, así que no se escribe nada que no tenga esa forma. */
const FORMA_AVISO = /^[A-Z][A-Z_]{0,39}$/;

// ── Lectura y escritura ──────────────────────────────────────────────────────

function esEntrada(o: unknown): o is Entrada {
  if (typeof o !== "object" || o === null) return false;
  const e = o as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.creado === "string" &&
    typeof e.activo === "string" &&
    typeof e.motivo === "string" &&
    (DECISIONES as readonly string[]).includes(e.decision as string)
  );
}

/**
 * Una entrada por línea. Tolerante: una línea rota se salta en vez de tumbar
 * el diario entero — el mismo criterio que el historial, y por lo mismo: lo
 * escriben dos personas desde dos navegadores, y una escritura a medias no
 * puede costar las otras veintinueve.
 */
export function leerDiario(texto: string): Entrada[] {
  const salida: Entrada[] = [];
  for (const linea of texto.split("\n")) {
    const t = linea.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (esEntrada(o)) salida.push(o);
    } catch {
      /* línea ilegible: se salta */
    }
  }
  return salida.sort((a, b) => Date.parse(a.creado) - Date.parse(b.creado));
}

/** Orden de claves fijo: el mismo diario produce los mismos bytes, y el diff
 *  de cada commit enseña solo lo que cambió. */
export function serializar(entradas: Entrada[]): string {
  const orden: (keyof Entrada)[] = [
    "id", "creado", "quien", "activo", "decision", "origen", "aviso", "motivo", "siguioPlan", "revision",
  ];
  return (
    entradas
      .map((e) => {
        const limpia: Record<string, unknown> = {};
        for (const k of orden) if (e[k] !== undefined) limpia[k] = e[k];
        return JSON.stringify(limpia);
      })
      .join("\n") + (entradas.length ? "\n" : "")
  );
}

export function nuevoId(ahora: number, azar: () => number = Math.random): string {
  return `${ahora.toString(36)}-${Math.floor(azar() * 36 ** 4).toString(36).padStart(4, "0")}`;
}

// ── Validación ───────────────────────────────────────────────────────────────

export type NuevaEntrada = Omit<Entrada, "id" | "creado" | "revision">;

export function validarEntrada(e: NuevaEntrada, activos: string[]): string[] {
  if (typeof e?.quien !== "string" || typeof e.motivo !== "string" || typeof e.activo !== "string") {
    return ["Entrada mal formada."];
  }
  const errores: string[] = [];
  if (!activos.includes(e.activo)) errores.push(`«${e.activo}» no está entre los activos vigilados.`);
  if (!(DECISIONES as readonly string[]).includes(e.decision)) errores.push("Elige qué decidiste.");
  if (!(PLANES as readonly string[]).includes(e.siguioPlan)) errores.push("Indica si seguiste tu plan.");
  if (e.origen !== "aviso" && e.origen !== "propia") errores.push("Origen desconocido.");
  if (!e.quien.trim()) errores.push("Pon tu nombre: el diario es de los dos.");
  if (e.quien.trim().length > QUIEN_MAXIMO) errores.push(`El nombre, en menos de ${QUIEN_MAXIMO} caracteres.`);
  if (e.motivo.length > MOTIVO_MAXIMO) errores.push(`El motivo, en menos de ${MOTIVO_MAXIMO} caracteres.`);
  if (e.aviso !== undefined && (typeof e.aviso !== "string" || !FORMA_AVISO.test(e.aviso))) {
    errores.push("Tipo de aviso desconocido.");
  }
  if (e.motivo.trim().length < MOTIVO_MINIMO) {
    // Un motivo de tres palabras no se puede revisar después: no deja nada que
    // juzgar. Quince caracteres es poco, pero obliga a escribir una frase.
    errores.push(`Escribe el motivo en una frase (mínimo ${MOTIVO_MINIMO} caracteres).`);
  }
  return errores;
}

/**
 * ¿Parece que el motivo lleva un monto?
 *
 * Aviso y no bloqueo: «subió 2x» o «rompió 0,08» son motivos legítimos y no
 * delatan cuánto dinero hay en juego. Lo que se busca son importes —un número
 * pegado a una moneda—, que es lo que el usuario decidió no publicar.
 */
export function pareceMonto(texto: string): boolean {
  const t = texto.toLowerCase();
  const numero = String.raw`\d[\d.,]*`;
  const moneda = String.raw`(?:\$|usd|usdt|ars|pesos?|dólares?|dolares?|lucas?|k\b)`;
  return new RegExp(String.raw`${moneda}\s*${numero}|${numero}\s*${moneda}`).test(t);
}

// ── Resultado ────────────────────────────────────────────────────────────────

/** El precio más cercano a `t`, si hay uno a menos de `tolerancia`. Con
 *  huecos en el historial —el cron se salta ejecuciones— no se inventa uno. */
export function precioEn(puntos: PuntoHistorial[], t: number, tolerancia = 2 * 60 * 60 * 1000): number | null {
  let mejor: PuntoHistorial | null = null;
  for (const p of puntos) {
    if (!mejor || Math.abs(p.t - t) < Math.abs(mejor.t - t)) mejor = p;
  }
  return mejor && Math.abs(mejor.t - t) <= tolerancia ? mejor.precio : null;
}

export type Resultado =
  | { estado: "pendiente" }
  | { estado: "sin-datos" }
  | { estado: "medido"; cambioPct: number; acerto: boolean | null };

/**
 * Qué hizo el precio en las 24 h siguientes a la decisión.
 *
 * «Acertó» solo tiene sentido para comprar y vender. Mantener o no hacer nada
 * no apuestan a una dirección, y forzarles un acierto sería inventar.
 */
export function resultado(e: Entrada, puntos: PuntoHistorial[], ahora: number): Resultado {
  const t0 = Date.parse(e.creado);
  if (!Number.isFinite(t0)) return { estado: "sin-datos" };
  if (ahora - t0 < HORIZONTE_MS) return { estado: "pendiente" };

  const antes = precioEn(puntos, t0);
  const despues = precioEn(puntos, t0 + HORIZONTE_MS);
  if (antes === null || despues === null || antes <= 0) return { estado: "sin-datos" };

  const cambioPct = ((despues - antes) / antes) * 100;
  const acerto = e.decision === "comprar" ? cambioPct > 0 : e.decision === "vender" ? cambioPct < 0 : null;
  return { estado: "medido", cambioPct, acerto };
}

// ── Estadísticas ─────────────────────────────────────────────────────────────

type Tasa = { n: number; aciertos: number };

export type Estadisticas = {
  total: number;
  /** Cuántas faltan para que los porcentajes signifiquen algo. */
  faltan: number;
  revisadas: number;
  porDecision: Record<Decision, number>;
  plan: Record<SiguioPlan, number>;
  /** Aciertos de comprar/vender según se siguiera el plan o no. */
  siguiendoPlan: Tasa;
  sinSeguirPlan: Tasa;
  /**
   * Proceso contra resultado, solo con entradas revisadas y medibles.
   * Las dos casillas cruzadas son las que enseñan algo:
   *   mala decisión y buen resultado → suerte, y la más peligrosa, porque
   *     enseña a repetir lo que no debería repetirse;
   *   buena decisión y mal resultado → mala suerte, el precio de jugar bien en
   *     un juego con azar. No hay que corregir nada.
   */
  cuadrante: { buenaBien: number; buenaMal: number; malaBien: number; malaMal: number };
};

export function estadisticas(
  entradas: Entrada[],
  historial: Record<string, PuntoHistorial[]>,
  ahora: number,
): Estadisticas {
  const porDecision = Object.fromEntries(DECISIONES.map((d) => [d, 0])) as Record<Decision, number>;
  const plan = Object.fromEntries(PLANES.map((p) => [p, 0])) as Record<SiguioPlan, number>;
  const siguiendoPlan: Tasa = { n: 0, aciertos: 0 };
  const sinSeguirPlan: Tasa = { n: 0, aciertos: 0 };
  const cuadrante = { buenaBien: 0, buenaMal: 0, malaBien: 0, malaMal: 0 };
  let revisadas = 0;

  for (const e of entradas) {
    porDecision[e.decision]++;
    plan[e.siguioPlan]++;
    if (e.revision) revisadas++;

    const r = resultado(e, historial[e.activo] ?? [], ahora);
    if (r.estado !== "medido" || r.acerto === null) continue;

    if (e.siguioPlan === "si") {
      siguiendoPlan.n++;
      if (r.acerto) siguiendoPlan.aciertos++;
    } else if (e.siguioPlan === "no") {
      sinSeguirPlan.n++;
      if (r.acerto) sinSeguirPlan.aciertos++;
    }

    // «Dudosa» no entra: forzarla a una casilla sería inventar el juicio.
    if (e.revision?.juicio === "buena") cuadrante[r.acerto ? "buenaBien" : "buenaMal"]++;
    if (e.revision?.juicio === "mala") cuadrante[r.acerto ? "malaBien" : "malaMal"]++;
  }

  return {
    total: entradas.length,
    faltan: Math.max(0, ENTRADAS_MINIMAS - entradas.length),
    revisadas,
    porDecision,
    plan,
    siguiendoPlan,
    sinSeguirPlan,
    cuadrante,
  };
}
