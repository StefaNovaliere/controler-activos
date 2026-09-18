/**
 * Dónde está AHORA el aviso de giro, en precio.
 *
 * Módulo PURO. Un umbral fijo es un número que alguien tecleó; el de giro NO
 * existe en la configuración: sale del máximo (o del mínimo) que el bot lleva
 * siguiendo, así que se mueve solo cada vez que el activo hace un máximo nuevo.
 * Para dibujarlo hay que reconstruirlo igual que lo hace el bot.
 */

export type NivelesGiro = { baja: number | null; sube: number | null };

function numero(valor: string | null | undefined): number | null {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  const n = Number(String(valor).replace(/,/g, "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function nivelesDeGiro(
  trailing: { drop_pct: string | null; rise_pct: string | null } | null | undefined,
  estado: { peak?: string; trough?: string } | undefined,
  ultimoPrecio: number | null,
): NivelesGiro {
  const caida = numero(trailing?.drop_pct);
  const subida = numero(trailing?.rise_pct);
  if (caida === null && subida === null) return { baja: null, sube: null };

  // Sin extremo guardado, el bot sembrará el rastro con el precio de su próxima
  // consulta. Usar aquí el máximo del historial daría un nivel más alto que el
  // real y enseñaría el aviso más cerca de lo que está.
  const peak = numero(estado?.peak) ?? ultimoPrecio;
  const trough = numero(estado?.trough) ?? ultimoPrecio;

  return {
    baja: caida !== null && peak !== null ? peak * (1 - caida / 100) : null,
    sube: subida !== null && trough !== null ? trough * (1 + subida / 100) : null,
  };
}
