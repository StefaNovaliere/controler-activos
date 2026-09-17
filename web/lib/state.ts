import "server-only";
import { readRaw, STATE_PATH } from "./github";
import type { StateFile } from "./types";

/**
 * Lee el estado que el bot deja en el repositorio.
 *
 * Se cachea 60 s: el fichero cambia como mucho cada 30 min, y aún menos porque
 * el bot no lo reescribe si nada se movió. Sin caché, cada render y cada pestaña
 * abierta serían una llamada a GitHub.
 */
export async function readState(): Promise<StateFile | null> {
  const raw = await readRaw(STATE_PATH, 60, "state");
  // 404 no es un error: significa que el vigilante todavía no se ha ejecutado
  // nunca. El panel tiene que arrancar bien ese primer día.
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as StateFile;
  } catch {
    return null;
  }
}
