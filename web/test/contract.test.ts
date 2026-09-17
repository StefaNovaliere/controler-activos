import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { validateSchema, KNOWN_PROVIDERS } from "../lib/schema";
import { crossChecks } from "../lib/crossChecks";
import { readAssets, declaredProviders } from "../lib/yaml";

type Case = { name: string; valid: boolean; expect?: string; yaml: string };
const CASES: Case[] = JSON.parse(
  readFileSync(join(__dirname, "../../schema/cases.json"), "utf8"),
).cases;

/** El veredicto del panel: esquema + reglas cruzadas + proveedores reales. */
function verdict(yamlText: string): string[] {
  const parsed = YAML.parse(yamlText);
  const errors = validateSchema(parsed);

  const declared = declaredProviders(yamlText);
  errors.push(...crossChecks(readAssets(yamlText), declared).map((e) => e.message));
  errors.push(
    ...declared
      .filter((name) => !KNOWN_PROVIDERS.includes(name))
      .map((name) => `proveedor desconocido: ${name}`),
  );
  return errors;
}

describe("corpus compartido con el bot", () => {
  // Si este test se separa de tests/test_schema_contract.py, la validación del
  // formulario y la del bot han divergido: uno de los dos se pone rojo.
  it.each(CASES.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const errors = verdict(testCase.yaml);
    if (testCase.valid) {
      expect(errors, `debía ser válido: ${errors.join(" · ")}`).toEqual([]);
    } else {
      expect(errors.length, "debía ser rechazado y pasó").toBeGreaterThan(0);
    }
  });

  it("la lista de proveedores viene del registro del bot", () => {
    expect(KNOWN_PROVIDERS).toEqual(["coingecko", "stooq", "twelvedata"]);
  });
});
