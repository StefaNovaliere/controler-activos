import "server-only";
import { readRaw } from "./github";
import { desde, ficheroDelAno, leerHistorial, submuestrear, type PuntoHistorial } from "./historial";

/**
 * El historial leído del repositorio.
 *
 * Se cachea 120 s: el fichero solo crece cuando corre el cron, cada 30 min. Sin
 * caché, cada render y cada pestaña abierta serían una descarga entera.
 *
 * Si falla, devuelve vacío en vez de romper: un gráfico es un extra, y la
 * tarjeta sin él sigue sirviendo para todo lo demás.
 */
export async function readHistorial(): Promise<Record<string, PuntoHistorial[]>> {
  try {
    const raw = await readRaw(ficheroDelAno(), 120, "historial");
    if (raw === null) return {};

    // Hasta 30 días, que es el rango más largo que ofrece el selector, y como
    // mucho 1500 puntos por activo. Un mes a un punto cada 15 minutos son ~2900
    // por activo: mandarlos todos engorda la página sin añadir un píxel, porque
    // el dibujo mide 260. El submuestreo conserva máximos y mínimos, así que el
    // recorte no cambia la forma.
    const MES = 30 * 24 * 60 * 60 * 1000;
    const crudo = leerHistorial(raw);
    const salida: Record<string, PuntoHistorial[]> = {};
    for (const [id, puntos] of Object.entries(crudo)) {
      salida[id] = submuestrear(desde(puntos, MES), 1500);
    }
    return salida;
  } catch {
    return {};
  }
}

/**
 * El historial del año sin recortar a 30 días ni submuestrear.
 *
 * Para el diario: el resultado de una decisión se mide contra el precio de SU
 * momento, que puede ser de hace meses. El recorte de `readHistorial` está
 * pensado para dibujar, no para medir, y ahí perdería las entradas viejas.
 *
 * Un año a un punto cada 10 minutos son ~50.000 filas por activo: cabe de sobra
 * en una función. Las entradas que cruzan el cambio de año se quedan sin
 * resultado hasta que haga falta leer dos ficheros.
 */
export async function readHistorialCompleto(): Promise<Record<string, PuntoHistorial[]>> {
  try {
    const raw = await readRaw(ficheroDelAno(), 300, "historial");
    return raw === null ? {} : leerHistorial(raw, Number.MAX_SAFE_INTEGER);
  } catch {
    return {};
  }
}
