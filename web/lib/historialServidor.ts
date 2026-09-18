import "server-only";
import { readRaw } from "./github";
import { ficheroDelAno, leerHistorial, type PuntoHistorial } from "./historial";

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
    return raw === null ? {} : leerHistorial(raw);
  } catch {
    return {};
  }
}
