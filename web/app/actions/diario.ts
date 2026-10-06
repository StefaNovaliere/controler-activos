"use server";

import { updateTag, revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { modificarDiario } from "@/lib/github";
import {
  JUICIOS,
  NOTA_MAXIMA,
  leerDiario,
  nuevoId,
  serializar,
  validarEntrada,
  type Entrada,
  type Juicio,
  type NuevaEntrada,
} from "@/lib/diario";
import { cargarAssets } from "./config";

export type ResultadoDiario = { ok: true } | { ok: false; errores: string[] };

function refrescar() {
  // `updateTag` y no `revalidateTag`: quien acaba de anotar tiene que verlo ya,
  // no en la próxima revalidación.
  updateTag("diario");
  revalidatePath("/diario");
}

/** Anota una decisión. El motivo queda escrito antes de saber el resultado,
 *  que es lo único que hace que el diario mida algo. */
export async function anotarAction(nueva: NuevaEntrada): Promise<ResultadoDiario> {
  await requireSession(); // el control de acceso real, no el proxy

  const { assets } = await cargarAssets();
  const errores = validarEntrada(nueva, assets.map((a) => a.id));
  if (errores.length) return { ok: false, errores };

  const ahora = Date.now();
  // Campo a campo y no `...nueva`: solo se escribe lo que el esquema conoce.
  const entrada: Entrada = {
    id: nuevoId(ahora),
    creado: new Date(ahora).toISOString(),
    quien: nueva.quien.trim(),
    activo: nueva.activo,
    decision: nueva.decision,
    origen: nueva.aviso ? "aviso" : "propia",
    ...(nueva.aviso ? { aviso: nueva.aviso } : {}),
    motivo: nueva.motivo.trim(),
    siguioPlan: nueva.siguioPlan,
  };

  try {
    const r = await modificarDiario(
      (texto) => serializar([...leerDiario(texto), entrada]),
      `diario: ${entrada.activo} · ${entrada.decision}`,
    );
    if (!r.ok) return { ok: false, errores: ["GitHub está ocupado: prueba otra vez en unos segundos."] };
  } catch (error) {
    return { ok: false, errores: [error instanceof Error ? error.message : String(error)] };
  }

  refrescar();
  return { ok: true };
}

/**
 * Juzga una decisión pasada con lo que se sabía ENTONCES.
 *
 * La interfaz no enseña el resultado hasta después de juzgar: si se ve antes,
 * contamina el juicio, y el diario acaba midiendo la suerte en vez del proceso.
 */
export async function revisarAction(id: string, juicio: Juicio, nota: string): Promise<ResultadoDiario> {
  await requireSession();
  if (!(JUICIOS as readonly string[]).includes(juicio)) return { ok: false, errores: ["Juicio desconocido."] };
  if (typeof id !== "string" || typeof nota !== "string") return { ok: false, errores: ["Revisión mal formada."] };
  if (nota.length > NOTA_MAXIMA) return { ok: false, errores: [`La nota, en menos de ${NOTA_MAXIMA} caracteres.`] };

  let encontrada = false;
  try {
    const r = await modificarDiario((texto) => {
      const entradas = leerDiario(texto).map((e) => {
        if (e.id !== id) return e;
        encontrada = true;
        return { ...e, revision: { creado: new Date().toISOString(), juicio, nota: nota.trim() } };
      });
      return serializar(entradas);
    }, `diario: revisión ${id}`);
    if (!r.ok) return { ok: false, errores: ["GitHub está ocupado: prueba otra vez en unos segundos."] };
  } catch (error) {
    return { ok: false, errores: [error instanceof Error ? error.message : String(error)] };
  }

  if (!encontrada) return { ok: false, errores: ["Esa entrada ya no existe."] };
  refrescar();
  return { ok: true };
}
