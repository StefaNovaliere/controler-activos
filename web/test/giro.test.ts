import { describe, expect, it } from "vitest";
import { nivelesDeGiro } from "../lib/giro";

describe("dónde cae el aviso de giro", () => {
  it("sale del máximo guardado, no del precio de ahora", () => {
    // Es la diferencia con un umbral fijo: aunque el precio haya bajado, el
    // aviso sigue colgando del máximo que llegó a hacer.
    const n = nivelesDeGiro({ drop_pct: "20", rise_pct: null }, { peak: "10" }, 7);
    expect(n.baja).toBeCloseTo(8, 6);
  });

  it("sin máximo guardado usa el precio de ahora, como hará el bot", () => {
    // El bot siembra el rastro con el precio de su próxima consulta. Usar el
    // máximo del historial daría un nivel más alto que el real y enseñaría el
    // aviso más cerca de lo que está.
    const n = nivelesDeGiro({ drop_pct: "20", rise_pct: null }, undefined, 5);
    expect(n.baja).toBeCloseTo(4, 6);
  });

  it("el rebote cuelga del mínimo", () => {
    const n = nivelesDeGiro({ drop_pct: null, rise_pct: "30" }, { trough: "2" }, 5);
    expect(n.sube).toBeCloseTo(2.6, 6);
  });

  it("sin trailing configurado no hay nivel que dibujar", () => {
    expect(nivelesDeGiro(null, { peak: "10" }, 7)).toEqual({ baja: null, sube: null });
    expect(nivelesDeGiro({ drop_pct: null, rise_pct: null }, { peak: "10" }, 7).baja).toBeNull();
  });

  it("tolera la coma decimal y los valores imposibles", () => {
    expect(nivelesDeGiro({ drop_pct: "20,5", rise_pct: null }, { peak: "10" }, 7).baja).toBeCloseTo(7.95, 6);
    expect(nivelesDeGiro({ drop_pct: "0", rise_pct: null }, { peak: "10" }, 7).baja).toBeNull();
    expect(nivelesDeGiro({ drop_pct: "20", rise_pct: null }, { peak: "0" }, null).baja).toBeNull();
  });
});
