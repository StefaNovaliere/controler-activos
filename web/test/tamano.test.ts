import { describe, expect, it } from "vitest";
import { calcular } from "../lib/tamano";

describe("cuánto poner", () => {
  it("el caso de manual: 2 % de 1000 con un stop del 40 %", () => {
    const r = calcular({ capital: 1000, riesgoPct: 2, precioEntrada: 1, stop: 0.6 })!;
    expect(r.distanciaPct).toBeCloseTo(40, 6);
    expect(r.posicion).toBeCloseTo(50, 6); // 20 $ de riesgo / 0,4
    expect(r.riesgoDinero).toBeCloseTo(20, 6);
    expect(r.cantidad).toBeCloseTo(50, 6);
    expect(r.limitadoPorCapital).toBe(false);
  });

  it("un stop más lejano obliga a una posición MÁS pequeña", () => {
    // Es lo contrario de lo que hace la intuición, y por eso hace falta la
    // cuenta: cuanto más margen le das al precio, menos dinero puedes poner.
    const cerca = calcular({ capital: 1000, riesgoPct: 2, precioEntrada: 1, stop: 0.9 })!;
    const lejos = calcular({ capital: 1000, riesgoPct: 2, precioEntrada: 1, stop: 0.5 })!;
    expect(lejos.posicion).toBeLessThan(cerca.posicion);
  });

  it("el riesgo en dinero se respeta, salga el tamaño que salga", () => {
    for (const stop of [0.9, 0.7, 0.5, 0.2]) {
      const r = calcular({ capital: 5000, riesgoPct: 1, precioEntrada: 1, stop })!;
      expect(r.riesgoDinero).toBeCloseTo(50, 6);
    }
  });

  it("avisa cuando el límite es el capital y no el riesgo que elegiste", () => {
    // Stop del 5 % y riesgo del 10 %: la fórmula pide el doble de lo que tienes.
    // Entonces el riesgo REAL ya no es el que pediste, y callarlo sería mentir.
    const r = calcular({ capital: 1000, riesgoPct: 10, precioEntrada: 1, stop: 0.95 })!;
    expect(r.limitadoPorCapital).toBe(true);
    expect(r.posicion).toBe(1000);
    expect(r.pesoPct).toBe(100);
    expect(r.riesgoDinero).toBeCloseTo(50, 6); // 5 % de 1000, no los 100 pedidos
  });

  it("un stop por encima de la entrada no es un stop", () => {
    expect(calcular({ capital: 1000, riesgoPct: 2, precioEntrada: 1, stop: 1.2 })).toBeNull();
    expect(calcular({ capital: 1000, riesgoPct: 2, precioEntrada: 1, stop: 1 })).toBeNull();
  });

  it("sin datos completos no inventa un número", () => {
    expect(calcular({ capital: 0, riesgoPct: 2, precioEntrada: 1, stop: 0.5 })).toBeNull();
    expect(calcular({ capital: 1000, riesgoPct: 2, precioEntrada: NaN, stop: 0.5 })).toBeNull();
  });

  it("funciona igual con los precios diminutos de una memecoin", () => {
    const r = calcular({ capital: 500, riesgoPct: 2, precioEntrada: 0.00000123, stop: 0.0000008 })!;
    expect(r.riesgoDinero).toBeCloseTo(10, 6);
    expect(r.cantidad).toBeGreaterThan(1_000_000);
  });
});
