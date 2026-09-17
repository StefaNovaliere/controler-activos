"use server";

import { updateTag, revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { readBlob, saveConfig, CONFIG_PATH, type SaveOutcome } from "@/lib/github";
import { applyAssets, declaredProviders, readAssets } from "@/lib/yaml";
import { crossChecks } from "@/lib/crossChecks";
import { callPython } from "@/lib/internal";
import type { AssetInput, Verdict, ResolvedAsset } from "@/lib/types";

export type SaveResult =
  | { status: "ok"; htmlUrl: string; reevaluados: string[] }
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

    const antes = await huellas(current.text);
    const verdict = await callPython<Verdict>("/api/validate", { yaml: yamlText });
    if (!verdict.ok) return { status: "invalid", errors: verdict.errors };

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
    return { status: "ok", htmlUrl: outcome.htmlUrl, reevaluados: cambiados(antes, verdict.assets) };
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
