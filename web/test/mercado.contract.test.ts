import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simular, type Punto } from "../lib/mercado";

/**
 * El mismo corpus que ejecuta `tests/test_engine_contract.py` contra el motor
 * real del bot.
 *
 * El panel le dice al usuario «con estos umbrales te habría avisado N veces»
 * para que pueda elegirlos sin saber de volatilidad. Ese número sale de la
 * simulación de este lado; el motor de verdad está en Python y no se puede
 * ejecutar desde el navegador. Si los dos se separan, el panel promete avisos
 * que no llegan — y el usuario habrá elegido su umbral confiando en eso.
 *
 * Python es el árbitro: si un caso discrepa, el que está mal es este lado.
 */
type Caso = {
  nombre: string;
  lower: string | null;
  upper: string | null;
  puntos: [number, string][];
  avisos: number;
  cooldown_minutes?: number;
  hysteresis_pct?: string;
  notify_on_return?: boolean;
  notify_transient?: boolean;
};

const CASOS: Caso[] = JSON.parse(
  readFileSync(join(__dirname, "../../schema/alert_cases.json"), "utf8"),
).cases;

const INICIO = Date.UTC(2026, 8, 10);

describe("la simulación del panel coincide con el motor del bot", () => {
  it("el corpus no está vacío, que pasaría en verde sin probar nada", () => {
    expect(CASOS.length).toBeGreaterThan(8);
  });

  for (const caso of CASOS) {
    it(caso.nombre, () => {
      const puntos: Punto[] = caso.puntos.map(([offset, precio]) => ({
        t: INICIO + offset,
        precio: Number(precio),
      }));

      const avisos = simular(
        puntos,
        caso.lower === null ? null : Number(caso.lower),
        caso.upper === null ? null : Number(caso.upper),
        {
          cooldownMinutos: caso.cooldown_minutes ?? 180,
          histeresisPct: Number(caso.hysteresis_pct ?? "0.25"),
          avisarAlVolver: caso.notify_on_return ?? true,
          avisarCruceBreve: caso.notify_transient ?? false,
        },
      );

      expect(avisos).toBe(caso.avisos);
    });
  }
});
