import { describe, expect, it } from "vitest";
import {
  clasificar,
  movimientosDiarios,
  percentil,
  perfilar,
  redondear,
  simular,
  sugerir,
  type Punto,
} from "../lib/mercado";

const HORA = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 10);

/** Serie horaria a partir de una lista de precios. */
function serie(precios: number[], pasoMs = HORA): Punto[] {
  return precios.map((precio, i) => ({ t: T0 + i * pasoMs, precio }));
}

describe("redondeo a cifras significativas", () => {
  it("funciona igual para un bitcoin que para una memecoin", () => {
    // Con decimales fijos, una memecoin se redondearía a cero, que es justo el
    // caso para el que hace falta esto.
    expect(redondear(76451.23)).toBe(76500);
    expect(redondear(0.07396078)).toBe(0.074);
    expect(redondear(0.00000123456)).toBe(0.00000123);
  });

  it("no revienta con cero ni con valores imposibles", () => {
    expect(redondear(0)).toBe(0);
    expect(redondear(Number.NaN)).toBe(0);
  });
});

describe("percentiles", () => {
  it("interpola en vez de saltar al vecino", () => {
    expect(percentil([0, 10], 50)).toBe(5);
    expect(percentil([1, 2, 3, 4], 50)).toBe(2.5);
  });

  it("una lista vacía no rompe nada", () => {
    expect(percentil([], 90)).toBe(0);
  });
});

describe("movimientos de 24 h", () => {
  it("compara por tiempo, no por posición en el array", () => {
    // Con datos cada 6 h, contar 24 índices miraría 6 días atrás. La ventana
    // tiene que salir de las marcas de tiempo o mide otra cosa sin avisar.
    const cada6h = serie([100, 100, 100, 100, 110], 6 * HORA);
    const movs = movimientosDiarios(cada6h);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toBeCloseTo(10, 6);
  });

  it("no inventa movimientos antes de tener 24 h de historia", () => {
    expect(movimientosDiarios(serie([100, 101, 102]))).toHaveLength(0);
  });
});

describe("perfil de un activo", () => {
  it("mide máximo, mínimo y dónde está el precio de ahora", () => {
    const p = perfilar(serie([100, 120, 80, 110]))!;
    expect(p.minimo).toBe(80);
    expect(p.maximo).toBe(120);
    expect(p.actual).toBe(110);
    expect(p.posicion).toBeCloseTo(75, 6); // 110 entre 80 y 120
    expect(p.cambioVentana).toBeCloseTo(10, 6);
  });

  it("con menos de dos puntos no se inventa un perfil", () => {
    expect(perfilar([])).toBeNull();
    expect(perfilar(serie([100]))).toBeNull();
  });

  it("ignora precios corruptos en vez de propagarlos", () => {
    const sucia = [...serie([100, 110]), { t: T0 + 2 * HORA, precio: 0 }];
    expect(perfilar(sucia)!.maximo).toBe(110);
  });
});

describe("umbrales sugeridos", () => {
  it("se ensanchan cuando el activo se mueve más", () => {
    // Dos activos al mismo precio pero con volatilidades distintas no pueden
    // recibir el mismo umbral: ese es el error que esto existe para evitar.
    const plano = perfilar(serie(Array.from({ length: 200 }, (_, i) => 100 + (i % 2))))!;
    const salvaje = perfilar(serie(Array.from({ length: 200 }, (_, i) => 100 * (1 + 0.3 * Math.sin(i / 5)))))!;
    expect(sugerir(salvaje).margenPct).toBeGreaterThan(sugerir(plano).margenPct);
  });

  it("nunca propone un margen ridículo aunque el activo esté dormido", () => {
    const plano = perfilar(serie(Array.from({ length: 200 }, () => 100)))!;
    const s = sugerir(plano);
    expect(s.margenPct).toBe(3);
    expect(s.lower).toBe(97);
    expect(s.upper).toBe(103);
  });

  it("deja el precio actual dentro del rango propuesto", () => {
    const p = perfilar(serie([1, 1.2, 0.9, 1.1, 1.05]))!;
    const s = sugerir(p);
    expect(s.lower).toBeLessThan(p.actual);
    expect(s.upper).toBeGreaterThan(p.actual);
  });
});

describe("clasificación, igual que en el bot", () => {
  it("un precio exactamente en el umbral está DENTRO", () => {
    expect(clasificar(100, 100, 200, null, 0.25)).toBe("inside");
    expect(clasificar(200, 100, 200, null, 0.25)).toBe("inside");
  });

  it("la histéresis solo cuesta al volver, no al salir", () => {
    // Saliendo: basta con cruzar.
    expect(clasificar(99.9, 100, 200, "inside", 0.25)).toBe("below");
    // Volviendo: rozar el umbral no basta, hay que recuperar el margen.
    expect(clasificar(100.1, 100, 200, "below", 0.25)).toBe("below");
    expect(clasificar(100.6, 100, 200, "below", 0.25)).toBe("inside");
  });
});

describe("cuántos avisos habrías recibido", () => {
  it("un precio que cruza una vez avisa una vez", () => {
    expect(simular(serie([100, 100, 100, 250]), 50, 200)).toBe(1);
  });

  it("sin umbrales no hay avisos", () => {
    expect(simular(serie([100, 500]), null, null)).toBe(0);
  });

  it("ruptura y vuelta al rango llevan relojes separados", () => {
    // Un solo reloj se tragaría el «ya volvió», que es la otra mitad de la
    // señal: te enterarías de que se disparó y no de que se normalizó.
    const s: Punto[] = [
      { t: T0, precio: 100 },
      { t: T0 + 10 * 60 * 1000, precio: 250 }, // rompe: aviso
      { t: T0 + 20 * 60 * 1000, precio: 100 }, // vuelve: aviso, pese al silencio
    ];
    expect(simular(s, 50, 200, { cooldownMinutos: 180 })).toBe(2);
  });

  it("el silencio retiene una segunda ruptura seguida", () => {
    const s: Punto[] = [
      { t: T0, precio: 100 },
      { t: T0 + HORA, precio: 250 }, // aviso 1
      { t: T0 + 1.2 * HORA, precio: 100 }, // aviso 2 (reloj propio)
      { t: T0 + 1.4 * HORA, precio: 250 }, // retenida: pendiente
      { t: T0 + 1.6 * HORA, precio: 100 }, // se deshizo antes de anunciarse
    ];
    expect(simular(s, 50, 200, { cooldownMinutos: 180 })).toBe(2);
  });

  it("un cruce que se deshace antes de anunciarse no avisa de nada", () => {
    // Ni siquiera de la vuelta al rango: nadie se enteró de la ruptura, así que
    // anunciar la recuperación solo confunde.
    const s: Punto[] = [
      { t: T0, precio: 100 },
      { t: T0 + HORA, precio: 250 }, // aviso 1
      { t: T0 + 1.2 * HORA, precio: 100 }, // aviso 2
      { t: T0 + 1.4 * HORA, precio: 250 }, // pendiente
      { t: T0 + 1.5 * HORA, precio: 100 }, // cruce breve: nada
    ];
    expect(simular(s, 50, 200)).toBe(2);
    expect(simular(s, 50, 200, { avisarCruceBreve: true })).toBe(3);
  });

  it("un cruce completo ignora el silencio, y descarta el pendiente", () => {
    // De un extremo al otro entre dos consultas es demasiado informativo para
    // callarlo. Y el pendiente que había NO se entrega además: se descarta.
    const s: Punto[] = [
      { t: T0, precio: 100 },
      { t: T0 + HORA, precio: 250 }, // aviso 1
      { t: T0 + 1.2 * HORA, precio: 100 }, // aviso 2
      { t: T0 + 1.3 * HORA, precio: 250 }, // retenida: pendiente
      { t: T0 + 1.5 * HORA, precio: 10 }, // arriba -> abajo: aviso 3, no 4
    ];
    expect(simular(s, 50, 200, { cooldownMinutos: 180 })).toBe(3);
  });

  it("pasado el silencio, una ruptura nueva vuelve a avisar", () => {
    const s: Punto[] = [
      { t: T0, precio: 100 },
      { t: T0 + HORA, precio: 250 },
      { t: T0 + 2 * HORA, precio: 100 },
      { t: T0 + 10 * HORA, precio: 250 },
    ];
    expect(simular(s, 50, 200, { cooldownMinutos: 180 })).toBe(3);
  });

  it("si el precio ya nacía fuera del rango, eso también es un aviso", () => {
    const s = serie([300, 300, 300]);
    expect(simular(s, 50, 200)).toBe(1);
    expect(simular(s, 50, 200, { avisarAlEmpezar: false })).toBe(0);
  });

  it("un umbral pegado al precio dispara muchos más avisos que uno amplio", () => {
    // Es la señal que hace entendible la elección: no hace falta saber de
    // volatilidad para leer «te habría avisado 12 veces».
    const ondulante = serie(Array.from({ length: 400 }, (_, i) => 100 * (1 + 0.1 * Math.sin(i / 3))));
    expect(simular(ondulante, 99, 101)).toBeGreaterThan(simular(ondulante, 50, 200));
    expect(simular(ondulante, 50, 200)).toBe(0);
  });

  it("si no quieres avisos de vuelta al rango, no se cuentan", () => {
    const s: Punto[] = [
      { t: T0, precio: 100 },
      { t: T0 + 10 * HORA, precio: 250 },
      { t: T0 + 20 * HORA, precio: 100 },
    ];
    expect(simular(s, 50, 200, { avisarAlVolver: true })).toBe(2);
    expect(simular(s, 50, 200, { avisarAlVolver: false })).toBe(1);
  });

  it("los umbrales sugeridos no generan una lluvia de avisos", () => {
    // La prueba de que la sugerencia sirve: sobre la misma serie de la que sale,
    // un puñado de avisos, no uno por hora.
    const ondulante = serie(Array.from({ length: 400 }, (_, i) => 100 * (1 + 0.15 * Math.sin(i / 7))));
    const p = perfilar(ondulante)!;
    const s = sugerir(p);
    expect(simular(ondulante, s.lower, s.upper)).toBeLessThan(10);
  });
});
