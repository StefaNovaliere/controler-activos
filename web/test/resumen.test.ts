import { describe, expect, it } from "vitest";

/** La lógica de la frase, extraída tal cual del componente para poder probarla.
 *  El fallo que cubre: con el umbral ya rebasado, la versión anterior decía
 *  "te avisaría si subiera un 8,9 %" cuando ese umbral estaba POR DEBAJO del
 *  precio. Misma distancia, sentido contrario, frase falsa. */
function frase(precio: number, lower: number | null, upper: number | null) {
  const pendientes: string[] = [];
  const cruzados: string[] = [];
  if (lower !== null) {
    if (precio > lower) pendientes.push(`si bajara hasta ${lower}`);
    else cruzados.push(`ha bajado de ${lower}`);
  }
  if (upper !== null) {
    if (precio < upper) pendientes.push(`si subiera hasta ${upper}`);
    else cruzados.push(`ha superado los ${upper}`);
  }
  return { pendientes, cruzados };
}

describe("la frase que resume un activo", () => {
  it("dentro del rango: los dos umbrales están pendientes", () => {
    const { pendientes, cruzados } = frase(76844, 55000, 95000);
    expect(pendientes).toHaveLength(2);
    expect(cruzados).toHaveLength(0);
  });

  it("umbral superior ya rebasado: no promete una subida", () => {
    // El caso real: BTC a 76 844 con el umbral de subida en 70 000.
    const { pendientes, cruzados } = frase(76844, null, 70000);
    expect(cruzados).toEqual(["ha superado los 70000"]);
    expect(pendientes).toEqual([]);
  });

  it("umbral inferior ya rebasado: no promete una bajada", () => {
    const { pendientes, cruzados } = frase(50000, 55000, 95000);
    expect(cruzados).toEqual(["ha bajado de 55000"]);
    expect(pendientes).toEqual(["si subiera hasta 95000"]);
  });

  it("el precio exactamente en el umbral cuenta como rebasado", () => {
    // Coherente con el motor: la comparación es estricta, price == upper es
    // DENTRO, pero la frase no debe prometer "si subiera un 0 %".
    expect(frase(70000, null, 70000).cruzados).toEqual(["ha superado los 70000"]);
  });
});
