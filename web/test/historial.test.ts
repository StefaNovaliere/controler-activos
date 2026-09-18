import { describe, expect, it } from "vitest";
import { ficheroDelAno, leerHistorial } from "../lib/historial";

const CSV = [
  "timestamp,asset_id,provider,price,currency",
  "2026-09-17T17:25:30Z,btc,coingecko,76844,usd",
  "2026-09-17T17:25:30Z,doge,coingecko,0.0815,usd",
  "2026-09-17T17:55:30Z,btc,coingecko,76451,usd",
].join("\n");

describe("historial de precios", () => {
  it("agrupa por activo y ordena por tiempo", () => {
    const h = leerHistorial(CSV);
    expect(Object.keys(h).sort()).toEqual(["btc", "doge"]);
    expect(h.btc.map((p) => p.precio)).toEqual([76844, 76451]);
    expect(h.btc[0].t).toBeLessThan(h.btc[1].t);
  });

  it("una fila ilegible se salta, no tumba la página", () => {
    // Lo escribe un proceso automático en cada ejecución: una línea a medio
    // escribir no puede costar el panel entero.
    const roto = CSV + "\n2026-09-17T18:25:30Z,btc,coingecko,,usd\nbasura\n,,,,";
    expect(leerHistorial(roto).btc).toHaveLength(2);
  });

  it("descarta precios imposibles en vez de dibujarlos", () => {
    expect(leerHistorial(CSV + "\n2026-09-17T18:25:30Z,btc,coingecko,0,usd").btc).toHaveLength(2);
    expect(leerHistorial(CSV + "\n2026-09-17T18:25:30Z,btc,coingecko,-5,usd").btc).toHaveLength(2);
  });

  it("se queda con los últimos puntos, no con el año entero", () => {
    const muchas = Array.from(
      { length: 300 },
      (_, i) => `2026-09-17T${String(i % 24).padStart(2, "0")}:00:00Z,btc,coingecko,${100 + i},usd`,
    ).join("\n");
    const h = leerHistorial(muchas, 50);
    expect(h.btc).toHaveLength(50);
    // Los ÚLTIMOS por tiempo, no los últimos del fichero.
    expect(h.btc[h.btc.length - 1].t).toBe(Math.max(...h.btc.map((p) => p.t)));
  });

  it("un fichero vacío o solo con cabecera no es un error", () => {
    expect(leerHistorial("")).toEqual({});
    expect(leerHistorial("timestamp,asset_id,provider,price,currency\n")).toEqual({});
  });

  it("el fichero se parte por años", () => {
    expect(ficheroDelAno(new Date("2026-09-18T00:00:00Z"))).toBe("history/prices-2026.csv");
    expect(ficheroDelAno(new Date("2027-01-01T00:00:00Z"))).toBe("history/prices-2027.csv");
  });
});
