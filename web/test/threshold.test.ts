import { describe, expect, it } from "vitest";
import { numeroDe, sugerencia } from "../components/ThresholdField";

/** El bug que cubren estos tests: el campo trataba "vacío" y "desactivado" como
 *  lo mismo, así que al borrar el último dígito se plegaba solo. Vaciar el campo
 *  es un paso normal al reescribir un número, no una orden de desactivar. */
describe("estado del campo de umbral", () => {
  it("null es desactivado, cadena vacía es activado y en blanco", () => {
    // La distinción vive en el tipo `string | null` y ahora se respeta.
    expect(numeroDe(null)).toBeNull();
    expect(numeroDe("")).toBeNull();
    expect(numeroDe("   ")).toBeNull();
  });

  it("un campo vacío no vale 0", () => {
    // Number("") es 0, y eso pintaba "0 % por debajo del precio actual"
    // con el campo en blanco.
    expect(numeroDe("")).not.toBe(0);
    expect(numeroDe("0")).toBe(0);
  });

  it("lee los números que se escriben a medias", () => {
    // Estados intermedios normales mientras se teclea: no deben romper nada.
    expect(numeroDe("5")).toBe(5);
    expect(numeroDe("55")).toBe(55);
    expect(numeroDe("55000")).toBe(55000);
    expect(numeroDe("1.0")).toBe(1);
    expect(numeroDe("0.00001234")).toBe(0.00001234);
  });

  it("lo que no es número se ignora en vez de propagarse como NaN", () => {
    expect(numeroDe("abc")).toBeNull();
    expect(numeroDe("-")).toBeNull();
  });
});

describe("valor propuesto al marcar la casilla", () => {
  it("propone un 10 % de margen, redondeado a algo tecleable", () => {
    expect(sugerencia(76844, -1)).toBe("69200");
    expect(sugerencia(76844, 1)).toBe("84500");
  });

  it("sin precio deja el campo en blanco, no un cero", () => {
    // Proponer 0 es peor que no proponer nada: parece un umbral válido.
    expect(sugerencia(null, -1)).toBe("");
    expect(sugerencia(null, 1)).toBe("");
  });

  it("funciona con precios pequeños, como los pares de divisas", () => {
    expect(Number(sugerencia(1.045, -1))).toBeCloseTo(0.94, 2);
  });
});

describe("guardar con la casilla marcada y el campo vacío", () => {
  it("se avisa en vez de borrar el umbral en silencio", async () => {
    const { crossChecks } = await import("../lib/crossChecks");
    const errores = crossChecks(
      [{ id: "btc", label: "Bitcoin", provider: "coingecko", symbol: "bitcoin",
         currency: "usd", lower: "", upper: "95000", enabled: true }],
      ["coingecko"],
    );
    expect(errores).toHaveLength(1);
    expect(errores[0].message).toMatch(/no has escrito ningún número/);
  });

  it("desmarcada (null) no es un error", async () => {
    const { crossChecks } = await import("../lib/crossChecks");
    const errores = crossChecks(
      [{ id: "btc", label: "Bitcoin", provider: "coingecko", symbol: "bitcoin",
         currency: "usd", lower: null, upper: "95000", enabled: true }],
      ["coingecko"],
    );
    expect(errores).toEqual([]);
  });
});

describe("activo añadido a mano", () => {
  const base = {
    id: "marscoin", label: "MARSCOIN", provider: "coingecko",
    currency: "usd", lower: null, upper: "0.5", enabled: true,
  };

  it("sin símbolo no se puede guardar", async () => {
    const { crossChecks } = await import("../lib/crossChecks");
    const errores = crossChecks([{ ...base, symbol: "" }], ["coingecko"]);
    expect(errores.some((e) => /Falta el símbolo/.test(e.message))).toBe(true);
  });

  it("con símbolo y un umbral, sí", async () => {
    const { crossChecks } = await import("../lib/crossChecks");
    expect(crossChecks([{ ...base, symbol: "marscoin" }], ["coingecko"])).toEqual([]);
  });
});
