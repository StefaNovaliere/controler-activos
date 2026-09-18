"use server";

import { updateTag, revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { readBlob, saveConfig, CONFIG_PATH, type SaveOutcome } from "@/lib/github";
import { applyAssets, declaredProviders, readAssets } from "@/lib/yaml";
import { crossChecks } from "@/lib/crossChecks";
import { callPython, PythonInalcanzable } from "@/lib/internal";
import type { AssetInput, Verdict, ResolvedAsset } from "@/lib/types";

export type SaveResult =
  | { status: "ok"; htmlUrl: string; reevaluados: string[]; degradado?: string }
  | { status: "invalid"; errors: string[] }
  | { status: "stale" }
  | { status: "busy" }
  | { status: "error"; message: string };

/**
 * Guarda la configuración.
 *
 * El orden importa: se valida con el pydantic DE VERDAD antes de commitear, así
 * que el panel no puede dejar el bot en un estado que no sepa leer. Las
 * comprobaciones de TypeScript son solo para marcar errores mientras se escribe.
 */
export async function guardarAction(assets: AssetInput[]): Promise<SaveResult> {
  await requireSession(); // el control de acceso real, no el proxy

  try {
    const current = await readBlob(CONFIG_PATH);
    if (!current) return { status: "error", message: "config/assets.yml no existe en la rama" };

    const rapidas = crossChecks(assets, declaredProviders(current.text));
    if (rapidas.length) return { status: "invalid", errors: rapidas.map((e) => e.message) };

    const yamlText = applyAssets(current.text, assets);

    // La puerta autoritativa. Si contesta que la configuración es inválida, no se
    // guarda: ese veredicto manda. Pero si la función está AVERIADA, bloquear el
    // guardado deja el panel inservible, y las comprobaciones de arriba ya han
    // cubierto las siete reglas que importan. Se guarda diciéndolo, y el paso de
    // CI que corre `vigilante check` en cada commit queda de red.
    let antes = new Map<string, string>();
    let verdict: Verdict | null = null;
    let degradado: string | undefined;

    try {
      antes = await huellas(current.text);
      verdict = await callPython<Verdict>("/api/validate", { yaml: yamlText });
    } catch (error) {
      if (!(error instanceof PythonInalcanzable)) throw error;
      degradado = error.message;
    }

    if (verdict && !verdict.ok) return { status: "invalid", errors: verdict.errors };

    const outcome: SaveOutcome = await saveConfig(
      yamlText,
      current.sha,
      `config(panel): ${describir(assets)}`,
    );

    if (!outcome.ok) return { status: outcome.reason };

    // `updateTag` y no `revalidateTag`: en una Server Action da semántica de
    // leer-lo-que-acabas-de-escribir, así que la página ya refleja el guardado.
    updateTag("state");
    revalidatePath("/");
    return {
      status: "ok",
      htmlUrl: outcome.htmlUrl,
      reevaluados: verdict?.ok ? cambiados(antes, verdict.assets) : [],
      degradado,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Comprueba un símbolo contra el proveedor real, antes de guardarlo. */
export async function probarAction(provider: string, symbol: string, currency: string) {
  await requireSession();
  try {
    return await callPython<{ ok: boolean; price?: string; currency?: string; as_of?: string; error?: string }>(
      "/api/probe",
      { provider, symbol, currency },
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Los activos cuya huella cambia: el bot los reevaluará desde cero. */
async function huellas(yamlText: string): Promise<Map<string, string>> {
  const verdict = await callPython<Verdict>("/api/validate", { yaml: yamlText });
  const map = new Map<string, string>();
  if (verdict.ok) for (const asset of verdict.assets) map.set(asset.id, asset.fingerprint);
  return map;
}

function cambiados(antes: Map<string, string>, despues: ResolvedAsset[]): string[] {
  return despues.filter((a) => antes.has(a.id) && antes.get(a.id) !== a.fingerprint).map((a) => a.label);
}

function describir(assets: AssetInput[]): string {
  const activos = assets.filter((a) => a.enabled).length;
  return `${assets.length} activo(s), ${activos} en vigilancia`;
}

/** Los activos actuales, leídos del repositorio. */
export async function cargarAssets(): Promise<{ assets: AssetInput[]; providers: string[] }> {
  await requireSession();
  const current = await readBlob(CONFIG_PATH);
  if (!current) return { assets: [], providers: [] };
  return { assets: readAssets(current.text), providers: declaredProviders(current.text) };
}

// ── Elegir una moneda sin teclear su id, y proponer umbrales ──────────────────

export type Candidata = {
  id: string;
  nombre: string;
  ticker: string;
  rango: number | null;
  imagen: string | null;
};

/**
 * Busca monedas por nombre en CoinGecko.
 *
 * Existe porque teclear el id a mano es la parte insegura del panel: hay
 * docenas de memecoins con nombres casi iguales, una letra de más apunta a otra
 * moneda que SÍ existe, y el bot vigilaría esa otra durante meses sin que nada
 * pareciera roto. Eligiendo de una lista, ese error deja de ser posible.
 */
export async function buscarMonedasAction(
  consulta: string,
): Promise<{ ok: true; monedas: Candidata[] } | { ok: false; error: string }> {
  await requireSession();
  try {
    const { buscarMonedas } = await import("@/lib/coingecko");
    return { ok: true, monedas: await buscarMonedas(consulta) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type Analisis = {
  actual: number;
  minimo: number;
  maximo: number;
  cambioVentana: number;
  diaTipico: number;
  diaFuerte: number;
  posicion: number;
  dias: number;
  muestras: number;
  divisa: string;
  sugerido: { lower: number; upper: number; margenPct: number; caidaPct: number };
  /** Avisos que habrías recibido en la ventana con los umbrales sugeridos. */
  avisosSugeridos: number;
  /** Lo mismo con los umbrales que el usuario tiene puestos ahora, si los hay. */
  avisosActuales: number | null;
  /** Caída desde el máximo que se propone, en %, y los avisos que habría dado. */
  giroPct: number;
  avisosGiro: number;
};

/**
 * Qué hace esta moneda y qué umbrales tienen sentido para ella.
 *
 * El número que de verdad decide es `avisos`: «te habría avisado 14 veces» se
 * entiende sin saber nada de volatilidad, mientras que «σ = 12 %» no. Y sale de
 * la misma lógica que el bot, verificada contra su motor real en
 * schema/alert_cases.json.
 */
export async function analizarAction(
  id: string,
  divisa: string,
  lowerActual: string | null,
  upperActual: string | null,
): Promise<{ ok: true; analisis: Analisis } | { ok: false; error: string }> {
  await requireSession();
  try {
    const { historial } = await import("@/lib/coingecko");
    const { perfilar, sugerir, simular, sugerirTrailing, simularTrailing } =
      await import("@/lib/mercado");

    const { puntos, divisa: usada } = await historial(id, divisa || "usd", 7);
    const perfil = perfilar(puntos);
    if (!perfil) return { ok: false, error: "No hay suficientes precios para calcular nada." };

    const sugerido = sugerir(perfil);
    const giroPct = sugerirTrailing(perfil);
    const lower = lowerActual ? Number(lowerActual) : null;
    const upper = upperActual ? Number(upperActual) : null;
    const hayActuales = (lower !== null && Number.isFinite(lower)) || (upper !== null && Number.isFinite(upper));

    return {
      ok: true,
      analisis: {
        ...perfil,
        divisa: usada,
        sugerido,
        avisosSugeridos: simular(puntos, sugerido.lower, sugerido.upper),
        avisosActuales: hayActuales ? simular(puntos, lower, upper) : null,
        giroPct,
        avisosGiro: simularTrailing(puntos, giroPct, null),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type RevisionToken = {
  puntos: { clave: string; titulo: string; estado: string; detalle: string }[];
  graves: number;
  avisos: number;
  desconocidos: number;
  twitter: string | null;
  web: string | null;
  direccion: string | null;
  plataforma: string | null;
  /** Por qué las comprobaciones del contrato salieron como salieron. */
  nota: string | null;
};

/**
 * La revisión del token: ¿está hecho para dejarte salir?
 *
 * Riesgo distinto del de precio y conviene no mezclarlos: que una moneda baje es
 * normal, y para eso están los umbrales. Que el contrato impida vender no es
 * riesgo de mercado, y cuesta el 100 % de golpe.
 */
export async function revisarTokenAction(
  id: string,
): Promise<{ ok: true; revision: RevisionToken } | { ok: false; error: string }> {
  await requireSession();
  try {
    const { revisarToken } = await import("@/lib/seguridad");
    const { revisar, resumir } = await import("@/lib/revision");

    const resultado = await revisarToken(id);
    if ("error" in resultado) return { ok: false, error: resultado.error };

    const puntos = revisar(resultado.datos);
    return {
      ok: true,
      revision: {
        puntos,
        ...resumir(puntos),
        twitter: resultado.identidad.twitter,
        web: resultado.identidad.web,
        direccion: resultado.identidad.direccion,
        plataforma: resultado.identidad.plataforma,
        nota: notaDeFuente(resultado.fuente, resultado.identidad.plataforma),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** El «sin comprobar» explicado. «9 puntos sin comprobar» sin decir por qué no
 *  es accionable: no se sabe si es que el analizador no cubre esa cadena, si no
 *  conoce el token todavía, o si se cayó. */
function notaDeFuente(
  fuente: { tipo: string; plataforma?: string | null },
  plataforma: string | null,
): string | null {
  if (fuente.tipo === "ok") return null;
  if (fuente.tipo === "cadena-no-soportada") {
    return plataforma
      ? `El analizador de contratos no cubre la red «${plataforma}», así que esas comprobaciones no se hicieron. La liquidez y la antigüedad sí son reales.`
      : "CoinGecko no dice en qué red vive este token, así que no se pudo analizar el contrato.";
  }
  return (
    "El analizador de contratos no devolvió datos para esta dirección. Suele pasar con tokens " +
    "muy nuevos o muy pequeños que todavía no ha indexado. Vuelve a intentarlo en unas horas."
  );
}
