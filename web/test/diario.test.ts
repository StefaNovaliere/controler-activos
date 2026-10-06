import { describe, expect, it } from "vitest";
import {
  ENTRADAS_MINIMAS,
  estadisticas,
  leerDiario,
  nuevoId,
  pareceMonto,
  precioEn,
  resultado,
  serializar,
  validarEntrada,
  type Entrada,
  type NuevaEntrada,
} from "../lib/diario";

const HORA = 3_600_000;
const DIA = 24 * HORA;
const T0 = Date.parse("2026-10-01T12:00:00Z");

function entrada(cambios: Partial<Entrada> = {}): Entrada {
  return {
    id: "a",
    creado: new Date(T0).toISOString(),
    quien: "Stefano",
    activo: "pepe",
    decision: "comprar",
    origen: "aviso",
    motivo: "rompió el umbral con volumen alto",
    siguioPlan: "si",
    ...cambios,
  };
}

/** Historial horario de 3 días con el precio que se le pida. */
function historial(precio: (h: number) => number) {
  return Array.from({ length: 72 }, (_, h) => ({ t: T0 + h * HORA, precio: precio(h) }));
}

describe("lectura y escritura", () => {
  it("ida y vuelta sin pérdidas", () => {
    const es = [entrada({ id: "1" }), entrada({ id: "2", revision: { creado: "x", juicio: "buena", nota: "" } })];
    expect(leerDiario(serializar(es))).toEqual(es);
  });

  it("una línea rota no cuesta las demás", () => {
    // Lo escriben dos personas desde dos navegadores: una escritura a medias
    // no puede llevarse por delante las otras veintinueve entradas.
    const texto = serializar([entrada({ id: "1" })]) + "{rota\n" + serializar([entrada({ id: "2" })]);
    expect(leerDiario(texto).map((e) => e.id)).toEqual(["1", "2"]);
  });

  it("los mismos datos dan los mismos bytes, para que el diff enseñe solo lo nuevo", () => {
    const e = entrada();
    // Mismas claves en orden inverso: lo único que cambia es la inserción.
    const desordenada = Object.fromEntries(Object.entries(e).reverse()) as Entrada;
    expect(serializar([desordenada])).toBe(serializar([e]));
  });

  it("vacío no es un error", () => {
    expect(leerDiario("")).toEqual([]);
    expect(serializar([])).toBe("");
  });

  it("los ids no se repiten aunque coincida el milisegundo", () => {
    let i = 0;
    const azar = () => (i++ % 2 ? 0.1 : 0.9);
    expect(nuevoId(T0, azar)).not.toBe(nuevoId(T0, azar));
  });
});

describe("validación", () => {
  const nueva = (cambios: Partial<NuevaEntrada> = {}): NuevaEntrada => {
    const { id, creado, revision, ...resto } = entrada();
    void id; void creado; void revision;
    return { ...resto, ...cambios };
  };

  it("una entrada completa pasa", () => {
    expect(validarEntrada(nueva(), ["pepe"])).toEqual([]);
  });

  it("un motivo de tres palabras no se puede revisar después", () => {
    expect(validarEntrada(nueva({ motivo: "me gusta" }), ["pepe"])).toHaveLength(1);
  });

  it("un activo que no se vigila no entra", () => {
    expect(validarEntrada(nueva({ activo: "inventada" }), ["pepe"])[0]).toMatch(/no está entre/);
  });

  it("el tipo de aviso viene de la URL: solo entra con forma de evento", () => {
    expect(validarEntrada(nueva({ aviso: "TRAILING_DROP" }), ["pepe"])).toEqual([]);
    expect(validarEntrada(nueva({ aviso: "<script>" }), ["pepe"])).toHaveLength(1);
  });

  it("una llamada a mano con tipos raros no rompe la acción", () => {
    expect(validarEntrada({ ...nueva(), motivo: 5 } as unknown as NuevaEntrada, ["pepe"])).toEqual([
      "Entrada mal formada.",
    ]);
  });

  it("sin nombre no sirve: el diario es de dos", () => {
    expect(validarEntrada(nueva({ quien: " " }), ["pepe"])).toHaveLength(1);
  });
});

describe("¿parece un monto?", () => {
  it("detecta importes, que es lo que se decidió no publicar", () => {
    expect(pareceMonto("puse $50 porque rompió")).toBe(true);
    expect(pareceMonto("compré 20 usd")).toBe(true);
    expect(pareceMonto("metí 10 lucas")).toBe(true);
    expect(pareceMonto("44.000 pesos de entrada")).toBe(true);
  });

  it("no molesta con motivos que no delatan dinero", () => {
    // «subió 2x» o «rompió 0,08» son motivos legítimos: dicen qué hizo el
    // precio, no cuánto hay en juego.
    expect(pareceMonto("subió 2x en un día y el volumen se triplicó")).toBe(false);
    expect(pareceMonto("rompió 0,08 con fuerza")).toBe(false);
    expect(pareceMonto("cayó un 20 % desde el máximo")).toBe(false);
  });
});

describe("el resultado se deriva, no se guarda", () => {
  it("precio más cercano, pero sin inventar uno en un hueco", () => {
    const puntos = [{ t: T0, precio: 1 }, { t: T0 + 10 * HORA, precio: 2 }];
    expect(precioEn(puntos, T0 + HORA)).toBe(1);
    expect(precioEn(puntos, T0 + 5 * HORA)).toBeNull(); // a 5 h de cualquiera
  });

  it("antes de 24 h está pendiente, no medido a medias", () => {
    expect(resultado(entrada(), historial(() => 1), T0 + 3 * HORA).estado).toBe("pendiente");
  });

  it("comprar acierta si sube, vender si baja", () => {
    const sube = historial((h) => 1 + h / 100);
    expect(resultado(entrada({ decision: "comprar" }), sube, T0 + 2 * DIA)).toMatchObject({ acerto: true });
    expect(resultado(entrada({ decision: "vender" }), sube, T0 + 2 * DIA)).toMatchObject({ acerto: false });
  });

  it("mantener y no hacer nada no apuestan a una dirección", () => {
    const sube = historial((h) => 1 + h / 100);
    expect(resultado(entrada({ decision: "mantener" }), sube, T0 + 2 * DIA)).toMatchObject({ acerto: null });
  });

  it("el horizonte es fijo: una entrada vieja no se mide contra ahora", () => {
    // Sube las primeras 24 h y después se desploma. A 24 h acertó; medido
    // contra «ahora» habría fallado. El plazo tiene que ser el mismo para todas.
    const subeYCae = historial((h) => (h <= 24 ? 1 + h / 10 : 0.1));
    expect(resultado(entrada(), subeYCae, T0 + 3 * DIA)).toMatchObject({ acerto: true });
  });

  it("sin precio en la ventana no se inventa un resultado", () => {
    expect(resultado(entrada(), [], T0 + 2 * DIA).estado).toBe("sin-datos");
  });
});

describe("estadísticas", () => {
  const sube = { pepe: historial((h) => 1 + h / 100) };
  const AHORA = T0 + 3 * DIA;

  it("dice cuántas faltan para que signifique algo", () => {
    expect(estadisticas([entrada()], sube, AHORA).faltan).toBe(ENTRADAS_MINIMAS - 1);
  });

  it("separa aciertos siguiendo el plan de aciertos improvisando", () => {
    const es = [
      entrada({ id: "1", siguioPlan: "si", decision: "comprar" }),
      entrada({ id: "2", siguioPlan: "no", decision: "vender" }),
    ];
    const s = estadisticas(es, sube, AHORA);
    expect(s.siguiendoPlan).toEqual({ n: 1, aciertos: 1 });
    expect(s.sinSeguirPlan).toEqual({ n: 1, aciertos: 0 });
  });

  it("el cuadrante cruza el juicio con el resultado", () => {
    const rev = (juicio: "buena" | "mala" | "dudosa") => ({ creado: "x", juicio, nota: "" });
    const es = [
      entrada({ id: "1", decision: "vender", revision: rev("buena") }), // buena y mal: mala suerte
      entrada({ id: "2", decision: "comprar", revision: rev("mala") }), // mala y bien: suerte
      entrada({ id: "3", decision: "comprar", revision: rev("dudosa") }), // no cuenta
    ];
    expect(estadisticas(es, sube, AHORA).cuadrante).toEqual({ buenaBien: 0, buenaMal: 1, malaBien: 1, malaMal: 0 });
  });
});
