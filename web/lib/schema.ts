import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import schema from "../generated/config.schema.json";
import providersFile from "../generated/providers.json";

/**
 * Validación de esquema para marcar errores mientras se escribe.
 *
 * NO es autoritativa: `/api/validate` ejecuta el pydantic de verdad y es quien
 * decide si algo se commitea. El esquema tiene un punto ciego conocido — pydantic
 * mapea `Decimal` como `anyOf: [number(con límites), string(solo patrón), null]`,
 * así que un `hysteresis_pct: "999"` se le escapa — y por eso `crossChecks` lo
 * comprueba aparte.
 */
const ajv = new Ajv2020({ allErrors: true, strict: false });

let compiled: ValidateFunction | null = null;

export function validateSchema(candidate: unknown): string[] {
  compiled ??= ajv.compile(schema);
  if (compiled(candidate)) return [];
  return (compiled.errors ?? []).map((error) => {
    const path = error.instancePath || "(raíz)";
    return `${path}: ${error.message ?? "inválido"}`;
  });
}

/** Proveedores que el bot conoce de verdad, generados desde su registro. */
export const KNOWN_PROVIDERS: string[] = providersFile.providers;
