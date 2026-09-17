/**
 * Las reglas que JSON Schema NO puede expresar.
 *
 * Son las mismas que aplica `src/vigilante/config.py`, y existen aquí solo para
 * dar el error mientras se escribe, sin ida y vuelta al servidor. **No son la
 * validación autoritativa**: esa es `/api/validate`, que ejecuta el pydantic de
 * verdad. Si estas dos se separan, `schema/cases.json` lo delata con un test
 * rojo en uno de los dos lados.
 */
import type { AssetInput } from "./types";

export type CrossCheckError = { assetId?: string; field?: string; message: string };

const ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;

export function crossChecks(assets: AssetInput[], declaredProviders: string[]): CrossCheckError[] {
  const errors: CrossCheckError[] = [];
  const declared = new Set(declaredProviders);
  const seen = new Set<string>();

  for (const asset of assets) {
    // 1. Patrón del id
    if (!ID_PATTERN.test(asset.id)) {
      errors.push({ assetId: asset.id, field: "id", message: "Solo letras, números, punto, guion y guion bajo." });
    }

    // 2. Ids únicos — `uniqueItems` compara objetos enteros, no la clave id.
    if (seen.has(asset.id)) {
      errors.push({ assetId: asset.id, field: "id", message: `El identificador "${asset.id}" está repetido.` });
    }
    seen.add(asset.id);

    // 3. Al menos un umbral, si no el activo no vigila nada.
    const lower = toNumber(asset.lower);
    const upper = toNumber(asset.upper);
    if (lower === null && upper === null) {
      errors.push({ assetId: asset.id, message: "Elige al menos un aviso, o este activo no vigilaría nada." });
    }

    // 4. Orden de los umbrales.
    if (lower !== null && upper !== null && lower >= upper) {
      errors.push({
        assetId: asset.id,
        message: `El aviso de bajada (${asset.lower}) tiene que ser menor que el de subida (${asset.upper}).`,
      });
    }

    // 5. Proveedor declarado — JSON Schema no permite referencias cruzadas
    //    entre dos ramas de la misma instancia.
    for (const name of [asset.provider, asset.fallback?.provider]) {
      if (name && !declared.has(name)) {
        errors.push({ assetId: asset.id, field: "provider", message: `El proveedor "${name}" no está configurado.` });
      }
    }

    // 6. Rango de la histéresis. El esquema de pydantic pone los límites solo en
    //    la rama numérica del Decimal, así que "999" como texto se le escapa.
    const hysteresis = toNumber(asset.hysteresis_pct ?? null);
    if (hysteresis !== null && (hysteresis < 0 || hysteresis > 50)) {
      errors.push({ assetId: asset.id, field: "hysteresis_pct", message: "El margen debe estar entre 0 y 50 %." });
    }

    if (asset.cooldown_minutes != null && asset.cooldown_minutes < 0) {
      errors.push({ assetId: asset.id, field: "cooldown_minutes", message: "El silencio no puede ser negativo." });
    }
  }

  // 7. Al menos un activo habilitado — vive en `load_config`, ni siquiera en el modelo.
  if (!assets.some((a) => a.enabled)) {
    errors.push({ message: "Tiene que quedar al menos un activo activo." });
  }

  return errors;
}

function toNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
