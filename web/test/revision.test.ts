import { describe, expect, it } from "vitest";
import { resumir, revisar, veredicto, type DatosToken } from "../lib/revision";

const AHORA = Date.UTC(2026, 8, 18);
const DIA = 86_400_000;

/** Un token que pasa todo: la base sobre la que se estropea un dato cada vez. */
function limpio(cambios: Partial<DatosToken> = {}): DatosToken {
  return {
    honeypot: false,
    puedeVenderTodo: true,
    codigoAbierto: true,
    emisionAbierta: false,
    duenoPuedeRecuperarControl: false,
    duenoPuedeCambiarSaldos: false,
    impuestoCompraPct: 0,
    impuestoVentaPct: 0,
    top10Pct: 12,
    liquidezBloqueadaPct: 100,
    liquidezUsd: 250_000,
    volumen24hUsd: 80_000,
    parCreadoEn: AHORA - 200 * DIA,
    compras24h: 400,
    ventas24h: 300,
    ...cambios,
  };
}

const punto = (d: DatosToken, clave: string) => revisar(d, AHORA).find((p) => p.clave === clave)!;

describe("lo que no se sabe se dice", () => {
  it("un dato ausente NO es un aprobado", () => {
    // Es la regla más importante del módulo: marcar «✓» algo que no se comprobó
    // es peor que no revisar nada, porque da confianza sin respaldo.
    const vacio: DatosToken = {
      honeypot: null, puedeVenderTodo: null, codigoAbierto: null, emisionAbierta: null,
      duenoPuedeRecuperarControl: null, duenoPuedeCambiarSaldos: null,
      impuestoCompraPct: null, impuestoVentaPct: null, top10Pct: null,
      liquidezBloqueadaPct: null, liquidezUsd: null, volumen24hUsd: null, parCreadoEn: null,
      compras24h: null, ventas24h: null,
    };
    const puntos = revisar(vacio, AHORA);
    expect(puntos.every((p) => p.estado === "desconocido")).toBe(true);
    expect(resumir(puntos)).toMatchObject({ graves: 0, avisos: 0, desconocidos: puntos.length });
  });
});

describe("las tres que te dejan sin nada", () => {
  it("el honeypot es grave, no un aviso", () => {
    expect(punto(limpio({ honeypot: true }), "honeypot").estado).toBe("grave");
    expect(punto(limpio({ honeypot: true }), "honeypot").detalle).toMatch(/no podrías salir/);
  });

  it("no poder vender la posición entera también", () => {
    expect(punto(limpio({ puedeVenderTodo: false }), "vender_todo").estado).toBe("grave");
  });

  it("que el dueño pueda cambiar saldos ajenos también", () => {
    expect(punto(limpio({ duenoPuedeCambiarSaldos: true }), "saldos").estado).toBe("grave");
  });
});

describe("liquidez, el dato que más gente ignora", () => {
  it("por debajo de 10 mil es grave: no podrías salir", () => {
    expect(punto(limpio({ liquidezUsd: 8_000 }), "liquidez").estado).toBe("grave");
  });

  it("entre 10 y 50 mil avisa de que tu propia venta mueve el precio", () => {
    const p = punto(limpio({ liquidezUsd: 34_000 }), "liquidez");
    expect(p.estado).toBe("aviso");
    expect(p.detalle).toMatch(/tu venta movería el precio/);
  });

  it("sin bloquear, la liquidez se puede retirar entera", () => {
    expect(punto(limpio({ liquidezBloqueadaPct: 10 }), "lp").estado).toBe("grave");
    expect(punto(limpio({ liquidezBloqueadaPct: 70 }), "lp").estado).toBe("aviso");
    expect(punto(limpio({ liquidezBloqueadaPct: 100 }), "lp").estado).toBe("ok");
  });
});

describe("concentración y comisiones", () => {
  it("la mitad del suministro en diez carteras es grave", () => {
    expect(punto(limpio({ top10Pct: 61 }), "top10").estado).toBe("grave");
    expect(punto(limpio({ top10Pct: 35 }), "top10").estado).toBe("aviso");
    expect(punto(limpio({ top10Pct: 12 }), "top10").estado).toBe("ok");
  });

  it("una comisión de venta abusiva se marca aunque la de compra sea cero", () => {
    // Es el patrón típico: entrar sale gratis, salir cuesta un tercio.
    const p = punto(limpio({ impuestoCompraPct: 0, impuestoVentaPct: 30 }), "impuestos");
    expect(p.estado).toBe("grave");
  });
});

describe("antigüedad", () => {
  it("los primeros días son donde ocurre casi todo el daño", () => {
    expect(punto(limpio({ parCreadoEn: AHORA - 1 * DIA }), "edad").estado).toBe("grave");
    expect(punto(limpio({ parCreadoEn: AHORA - 10 * DIA }), "edad").estado).toBe("aviso");
    expect(punto(limpio({ parCreadoEn: AHORA - 200 * DIA }), "edad").estado).toBe("ok");
  });

  it("una fecha futura es un dato roto, no un token viejo", () => {
    expect(punto(limpio({ parCreadoEn: AHORA + 5 * DIA }), "edad").estado).toBe("desconocido");
  });
});

describe("el orden de lectura", () => {
  it("lo grave va primero: si hay un honeypot es lo único que importa leer", () => {
    const puntos = revisar(limpio({ honeypot: true, top10Pct: 35 }), AHORA);
    expect(puntos[0].clave).toBe("honeypot");
    expect(puntos[0].estado).toBe("grave");
  });

  it("un token limpio no genera ni un aviso", () => {
    expect(resumir(revisar(limpio(), AHORA))).toEqual({ graves: 0, avisos: 0, desconocidos: 0 });
  });
});

describe("el titular no puede prometer más de lo que se comprobó", () => {
  it("con la mayoría sin comprobar, no dice «ninguna señal de trampa»", () => {
    // Las comprobaciones que faltan cuando GoPlus no responde son JUSTO las que
    // detectan la trampa. Decir «todo bien» ahí sería lo más peligroso que
    // podría hacer esta pantalla: da vía libre sin haber mirado.
    const soloMercado: DatosToken = {
      honeypot: null, puedeVenderTodo: null, codigoAbierto: null, emisionAbierta: null,
      duenoPuedeRecuperarControl: null, duenoPuedeCambiarSaldos: null,
      impuestoCompraPct: null, impuestoVentaPct: null, top10Pct: null,
      liquidezBloqueadaPct: null,
      liquidezUsd: 4_400_000,
      volumen24hUsd: 500_000,
      parCreadoEn: AHORA - 58 * DIA,
      compras24h: null,
      ventas24h: null,
    };
    const puntos = revisar(soloMercado, AHORA);
    const r = resumir(puntos);

    expect(r.graves).toBe(0);
    expect(r.avisos).toBe(0);
    // La condición que usa la interfaz para no cantar victoria.
    expect(r.desconocidos).toBeGreaterThan(puntos.length / 2);
  });
});


describe("¿hay ventas reales? — funciona sin analizador de contratos", () => {
  it("cientos de compras y casi ninguna venta es el síntoma del honeypot", () => {
    // Esto NO viene del analizador: sale de contar operaciones, así que
    // funciona en cualquier cadena, incluidas las que nadie analiza todavía.
    // Y es justo ahí donde hace falta.
    const p = punto(limpio({ compras24h: 400, ventas24h: 12 }), "ventas");
    expect(p.estado).toBe("grave");
    expect(p.detalle).toMatch(/honeypot/);
  });

  it("vender poco pero vender no es lo mismo", () => {
    expect(punto(limpio({ compras24h: 400, ventas24h: 60 }), "ventas").estado).toBe("aviso");
    expect(punto(limpio({ compras24h: 400, ventas24h: 300 }), "ventas").estado).toBe("ok");
  });

  it("con pocas operaciones la proporción es ruido, y se dice", () => {
    // Dos ventas de cinco compras no significan nada; presentarlo como señal
    // sería inventar precisión.
    const p = punto(limpio({ compras24h: 5, ventas24h: 0 }), "ventas");
    expect(p.estado).toBe("desconocido");
    expect(p.detalle).toMatch(/muy pocas para juzgar/);
  });
});

describe("volumen contra liquidez", () => {
  it("un volumen desproporcionado puede ser inflado", () => {
    expect(punto(limpio({ liquidezUsd: 20_000, volumen24hUsd: 900_000 }), "lavado").estado).toBe("aviso");
  });

  it("una proporción normal no molesta", () => {
    expect(punto(limpio({ liquidezUsd: 200_000, volumen24hUsd: 300_000 }), "lavado").estado).toBe("ok");
  });
});


describe("el veredicto dice lo que de verdad se comprobó", () => {
  /** Lo que devuelve DexScreener cuando el contrato no se puede analizar. */
  function soloMercado(cambios: Partial<DatosToken> = {}): DatosToken {
    return {
      honeypot: null, puedeVenderTodo: null, codigoAbierto: null, emisionAbierta: null,
      duenoPuedeRecuperarControl: null, duenoPuedeCambiarSaldos: null,
      impuestoCompraPct: null, impuestoVentaPct: null, top10Pct: null, liquidezBloqueadaPct: null,
      liquidezUsd: 4_400_000, volumen24hUsd: 5_000_000, parCreadoEn: AHORA - 58 * DIA,
      compras24h: 1559, ventas24h: 1214,
      ...cambios,
    };
  }

  it("con ventas reales NO dice que falte justo lo que detecta la trampa", () => {
    // Mil personas vendiendo en 24 h demuestra que el contrato no bloquea las
    // ventas mejor que analizar el código, porque no se deduce: ocurrió.
    // Decir «no se comprobó nada» ahí engaña tanto como decir «todo bien».
    expect(veredicto(revisar(soloMercado(), AHORA))).toBe("parcial-con-ventas");
  });

  it("sin datos de ventas sí es una revisión incompleta", () => {
    const sinVentas = soloMercado({ compras24h: null, ventas24h: null, volumen24hUsd: null });
    expect(veredicto(revisar(sinVentas, AHORA))).toBe("incompleto");
  });

  it("un problema grave manda por encima de todo lo demás", () => {
    expect(veredicto(revisar(soloMercado({ liquidezUsd: 5_000 }), AHORA))).toBe("graves");
  });

  it("todo comprobado y sin pegas es limpio", () => {
    expect(veredicto(revisar(limpio(), AHORA))).toBe("limpio");
  });

  it("un aviso impide cantar victoria aunque no haya nada grave", () => {
    expect(veredicto(revisar(limpio({ top10Pct: 35 }), AHORA))).toBe("avisos");
  });
});
