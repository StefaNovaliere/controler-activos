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
