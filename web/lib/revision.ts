/**
 * La revisión del token: ¿está hecho para dejarte salir?
 *
 * Módulo PURO. Aquí vive el criterio —qué cuenta como aviso y qué no— separado
 * de quién trae los datos, para poder probarlo entero sin red.
 *
 * Es un riesgo distinto del de precio, y conviene no mezclarlos: que una moneda
 * baje es normal y para eso están los umbrales. Que el contrato esté programado
 * para que no puedas vender no es riesgo de mercado, es otra cosa, y te cuesta
 * el 100 % de golpe.
 *
 * REGLA DE ORO DE ESTE MÓDULO: lo que no se sabe se dice. Un dato que el
 * proveedor no devuelve NO es un aprobado. Marcar como «✓» algo que no se
 * comprobó es peor que no revisar nada, porque da confianza sin respaldo.
 */

export type Severidad = "ok" | "aviso" | "grave" | "desconocido";

export type Punto = {
  clave: string;
  titulo: string;
  estado: Severidad;
  detalle: string;
};

/** Los datos ya normalizados, vengan de donde vengan. */
export type DatosToken = {
  honeypot: boolean | null;
  /** Falso si el contrato impide vender la posición entera. */
  puedeVenderTodo: boolean | null;
  codigoAbierto: boolean | null;
  emisionAbierta: boolean | null;
  duenoPuedeRecuperarControl: boolean | null;
  duenoPuedeCambiarSaldos: boolean | null;
  impuestoCompraPct: number | null;
  impuestoVentaPct: number | null;
  top10Pct: number | null;
  liquidezBloqueadaPct: number | null;
  liquidezUsd: number | null;
  volumen24hUsd: number | null;
  parCreadoEn: number | null;
  /** Operaciones de compra y de venta de las últimas 24 h. */
  compras24h: number | null;
  ventas24h: number | null;
};

const DESCONOCIDO = "el proveedor no devolvió este dato";

function bandera(
  clave: string,
  titulo: string,
  valor: boolean | null,
  malo: boolean,
  textoOk: string,
  textoMalo: string,
  severidad: Severidad = "aviso",
): Punto {
  if (valor === null) return { clave, titulo, estado: "desconocido", detalle: DESCONOCIDO };
  return valor === malo
    ? { clave, titulo, estado: severidad, detalle: textoMalo }
    : { clave, titulo, estado: "ok", detalle: textoOk };
}

function dinero(valor: number): string {
  return valor >= 1_000_000
    ? `${(valor / 1_000_000).toFixed(1).replace(".", ",")} M$`
    : `${Math.round(valor).toLocaleString("es-AR")} $`;
}

export function revisar(d: DatosToken, ahora = Date.now()): Punto[] {
  const puntos: Punto[] = [
    bandera(
      "honeypot", "Se puede vender", d.honeypot, true,
      "comprobado: la venta no está bloqueada",
      "HONEYPOT: el contrato impide vender. Comprarías y no podrías salir.",
      "grave",
    ),
    bandera(
      "vender_todo", "Se puede vender todo", d.puedeVenderTodo, false,
      "sin límite por operación",
      "el contrato impide vender la posición entera de una vez",
      "grave",
    ),
    bandera(
      "saldos", "El dueño no toca tu saldo", d.duenoPuedeCambiarSaldos, true,
      "no puede modificarlo",
      "el dueño del contrato puede cambiar saldos ajenos: puede dejarte en cero",
      "grave",
    ),
    bandera(
      "emision", "Suministro cerrado", d.emisionAbierta, true,
      "no se pueden crear tokens nuevos",
      "el dueño puede emitir tokens nuevos y diluirte cuando quiera",
    ),
    bandera(
      "control", "Control renunciado", d.duenoPuedeRecuperarControl, true,
      "el dueño no puede recuperar privilegios",
      "el dueño puede recuperar el control del contrato más adelante",
    ),
    bandera(
      "codigo", "Contrato verificado", d.codigoAbierto, false,
      "el código es público y auditable",
      "el código no está publicado: nadie puede saber qué hace",
    ),
    impuestos(d),
    concentracion(d),
    liquidez(d),
    liquidezBloqueada(d),
    antiguedad(d, ahora),
    ventasReales(d),
    lavado(d),
  ];

  // Lo más grave primero: si hay un honeypot, es lo único que importa leer.
  const orden: Record<Severidad, number> = { grave: 0, aviso: 1, desconocido: 2, ok: 3 };
  return puntos.sort((a, b) => orden[a.estado] - orden[b.estado]);
}

function impuestos(d: DatosToken): Punto {
  const { impuestoCompraPct: compra, impuestoVentaPct: venta } = d;
  if (compra === null && venta === null) {
    return { clave: "impuestos", titulo: "Comisiones del contrato", estado: "desconocido", detalle: DESCONOCIDO };
  }
  const peor = Math.max(compra ?? 0, venta ?? 0);
  const texto = `compra ${(compra ?? 0).toFixed(0)} % · venta ${(venta ?? 0).toFixed(0)} %`;

  // Por encima del 10 % la comisión se come cualquier movimiento razonable; por
  // encima del 25 % el token está diseñado para quedarse con tu dinero.
  if (peor >= 25) return { clave: "impuestos", titulo: "Comisiones del contrato", estado: "grave", detalle: `${texto} — abusivo` };
  if (peor >= 10) return { clave: "impuestos", titulo: "Comisiones del contrato", estado: "aviso", detalle: `${texto} — alto` };
  return { clave: "impuestos", titulo: "Comisiones del contrato", estado: "ok", detalle: texto };
}

function concentracion(d: DatosToken): Punto {
  const titulo = "Reparto del suministro";
  if (d.top10Pct === null) return { clave: "top10", titulo, estado: "desconocido", detalle: DESCONOCIDO };

  const texto = `las 10 mayores carteras tienen el ${Math.round(d.top10Pct)} %`;
  if (d.top10Pct >= 50) return { clave: "top10", titulo, estado: "grave", detalle: `${texto}: una sola venta hunde el precio` };
  if (d.top10Pct >= 30) return { clave: "top10", titulo, estado: "aviso", detalle: `${texto}: concentrado` };
  return { clave: "top10", titulo, estado: "ok", detalle: texto };
}

function liquidez(d: DatosToken): Punto {
  const titulo = "Liquidez";
  if (d.liquidezUsd === null) return { clave: "liquidez", titulo, estado: "desconocido", detalle: DESCONOCIDO };

  const texto = dinero(d.liquidezUsd);
  // El dato que más gente ignora: podés acertar el movimiento y no poder salir.
  // Con poca liquidez tu propia venta te mueve el precio en contra.
  if (d.liquidezUsd < 10_000)
    return { clave: "liquidez", titulo, estado: "grave", detalle: `${texto}: no podrías salir sin hundir el precio` };
  if (d.liquidezUsd < 50_000)
    return { clave: "liquidez", titulo, estado: "aviso", detalle: `${texto}: baja, tu venta movería el precio` };
  return { clave: "liquidez", titulo, estado: "ok", detalle: texto };
}

function liquidezBloqueada(d: DatosToken): Punto {
  const titulo = "Liquidez bloqueada";
  if (d.liquidezBloqueadaPct === null)
    return { clave: "lp", titulo, estado: "desconocido", detalle: DESCONOCIDO };

  const texto = `${Math.round(d.liquidezBloqueadaPct)} % bloqueada o quemada`;
  // Sin bloquear, quien la puso puede retirarla entera: es el rug pull clásico.
  if (d.liquidezBloqueadaPct < 50)
    return { clave: "lp", titulo, estado: "grave", detalle: `${texto}: pueden retirarla y dejar el par seco` };
  if (d.liquidezBloqueadaPct < 90)
    return { clave: "lp", titulo, estado: "aviso", detalle: texto };
  return { clave: "lp", titulo, estado: "ok", detalle: texto };
}

function antiguedad(d: DatosToken, ahora: number): Punto {
  const titulo = "Antigüedad";
  if (d.parCreadoEn === null) return { clave: "edad", titulo, estado: "desconocido", detalle: DESCONOCIDO };

  const dias = (ahora - d.parCreadoEn) / 86_400_000;
  if (dias < 0) return { clave: "edad", titulo, estado: "desconocido", detalle: "fecha de creación inconsistente" };

  const texto = dias < 1 ? "menos de un día" : `${Math.floor(dias)} día(s)`;
  if (dias < 3) return { clave: "edad", titulo, estado: "grave", detalle: `${texto}: la mayoría de los rug pulls ocurren aquí` };
  if (dias < 30) return { clave: "edad", titulo, estado: "aviso", detalle: texto };
  return { clave: "edad", titulo, estado: "ok", detalle: texto };
}

/** El resumen de una revisión, para el encabezado. */
export function resumir(puntos: Punto[]): { graves: number; avisos: number; desconocidos: number } {
  return {
    graves: puntos.filter((p) => p.estado === "grave").length,
    avisos: puntos.filter((p) => p.estado === "aviso").length,
    desconocidos: puntos.filter((p) => p.estado === "desconocido").length,
  };
}

/**
 * ¿Hay gente vendiendo de verdad?
 *
 * Esto NO viene del analizador de contratos: sale de contar operaciones en el
 * mercado, así que funciona en cualquier cadena, incluidas las que ningún
 * analizador cubre todavía. Y es justo donde más falta hace.
 *
 * El razonamiento: si cientos de personas compraron y casi ninguna consiguió
 * vender, algo impide vender. No prueba que sea un honeypot —puede ser una
 * moneda en pleno frenesí donde nadie QUIERE vender— pero es el síntoma, y ante
 * un contrato que nadie ha analizado es la mejor evidencia disponible.
 */
function ventasReales(d: DatosToken): Punto {
  const titulo = "Hay ventas reales";
  const { compras24h: compras, ventas24h: ventas } = d;
  if (compras === null || ventas === null)
    return { clave: "ventas", titulo, estado: "desconocido", detalle: DESCONOCIDO };

  const texto = `${compras} compras y ${ventas} ventas en 24 h`;
  // Con pocas operaciones la proporción es ruido: dos ventas de cinco compras
  // no dicen nada. Hace falta una muestra mínima para que signifique algo.
  if (compras < 20) return { clave: "ventas", titulo, estado: "desconocido", detalle: `${texto}: muy pocas para juzgar` };

  const proporcion = ventas / compras;
  if (proporcion < 0.1)
    return {
      clave: "ventas",
      titulo,
      estado: "grave",
      detalle: `${texto}: casi nadie consigue vender, síntoma clásico de honeypot`,
    };
  if (proporcion < 0.25)
    return { clave: "ventas", titulo, estado: "aviso", detalle: `${texto}: se vende muy poco para lo que se compra` };
  return { clave: "ventas", titulo, estado: "ok", detalle: texto };
}

/**
 * Volumen contra liquidez.
 *
 * Un volumen enorme sobre una liquidez mínima suele ser volumen inflado: unas
 * pocas carteras comprándose y vendiéndose entre ellas para que la moneda
 * aparezca en las listas de «más negociadas». Con matices: en un frenesí real
 * también sube mucho, así que es aviso y no grave.
 */
function lavado(d: DatosToken): Punto {
  const titulo = "Volumen creíble";
  if (d.volumen24hUsd === null || d.liquidezUsd === null || d.liquidezUsd <= 0)
    return { clave: "lavado", titulo, estado: "desconocido", detalle: DESCONOCIDO };

  const veces = d.volumen24hUsd / d.liquidezUsd;
  const texto = `se negoció ${veces.toFixed(1).replace(".", ",")} veces la liquidez del par`;
  if (veces > 20) return { clave: "lavado", titulo, estado: "aviso", detalle: `${texto}: puede ser volumen inflado` };
  return { clave: "lavado", titulo, estado: "ok", detalle: texto };
}
