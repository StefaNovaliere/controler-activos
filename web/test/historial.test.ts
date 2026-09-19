import { describe, expect, it } from "vitest";
import { desde, ficheroDelAno, leerHistorial, submuestrear } from "../lib/historial";

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

describe("recortar por tiempo", () => {
  const AHORA = Date.parse("2026-09-19T12:00:00Z");
  const HORA = 3_600_000;
  const serie = Array.from({ length: 100 }, (_, i) => ({ t: AHORA - i * HORA, precio: 10 + i }));

  it("un número de puntos no dice cuánto tiempo abarca", () => {
    // El bug que trajo esto: el tope era 120 puntos, el cron pasó de 30 a 15
    // minutos y la ventana se encogió de 2,5 días a 30 horas sola.
    expect(desde(serie, 24 * HORA, AHORA)).toHaveLength(25);
    expect(desde(serie, 48 * HORA, AHORA)).toHaveLength(49);
  });

  it("sin rango no recorta nada", () => {
    expect(desde(serie, null, AHORA)).toHaveLength(100);
  });
});

describe("submuestreo", () => {
  const T0 = Date.parse("2026-09-01T00:00:00Z");
  const MIN = 60_000;

  it("un pico de una sola muestra NO desaparece", () => {
    // Quedarse con uno de cada N es lo rápido y lo equivocado: borra justo los
    // picos, que son lo que se está mirando.
    const llana = Array.from({ length: 1000 }, (_, i) => ({ t: T0 + i * MIN, precio: 100 }));
    llana[500] = { t: T0 + 500 * MIN, precio: 999 };

    const reducida = submuestrear(llana, 100);
    expect(reducida.length).toBeLessThanOrEqual(101);
    expect(Math.max(...reducida.map((p) => p.precio))).toBe(999);
  });

  it("conserva también el mínimo, no solo el máximo", () => {
    const llana = Array.from({ length: 1000 }, (_, i) => ({ t: T0 + i * MIN, precio: 100 }));
    llana[300] = { t: T0 + 300 * MIN, precio: 1 };
    expect(Math.min(...submuestrear(llana, 100).map((p) => p.precio))).toBe(1);
  });

  it("el resultado sigue ordenado en el tiempo", () => {
    const zigzag = Array.from({ length: 800 }, (_, i) => ({
      t: T0 + i * MIN,
      precio: 100 + 30 * Math.sin(i / 3),
    }));
    const r = submuestrear(zigzag, 60);
    for (let i = 1; i < r.length; i++) expect(r[i].t).toBeGreaterThanOrEqual(r[i - 1].t);
  });

  it("el último punto es el precio de ahora y no se pierde", () => {
    const serie = Array.from({ length: 501 }, (_, i) => ({ t: T0 + i * MIN, precio: 100 + i }));
    const r = submuestrear(serie, 50);
    expect(r[r.length - 1]).toEqual(serie[serie.length - 1]);
  });

  it("una serie ya corta no se toca", () => {
    const corta = [
      { t: T0, precio: 1 },
      { t: T0 + MIN, precio: 2 },
    ];
    expect(submuestrear(corta, 100)).toEqual(corta);
  });
});
