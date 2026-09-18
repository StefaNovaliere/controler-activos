import "server-only";
import type { DatosToken } from "./revision";

/**
 * De dónde salen los datos de la revisión del token.
 *
 * Tres fuentes, todas gratuitas y sin clave, encadenadas:
 *
 *   1. CoinGecko /coins/{id}  →  dirección del contrato y en qué cadena vive.
 *      El panel guarda ids de CoinGecko («artificial-inu-3»), no direcciones,
 *      así que este paso es el puente obligado.
 *   2. DexScreener            →  liquidez real, volumen y edad del par.
 *   3. GoPlus Security        →  qué permite y qué impide el contrato.
 *
 * Todo el parseo es defensivo y devuelve `null` ante cualquier sorpresa, nunca
 * un valor por defecto optimista. `revision.ts` convierte ese `null` en
 * «desconocido», que es lo honesto: si un campo cambia de nombre en el
 * proveedor, la revisión lo dirá en vez de aprobar algo que no comprobó.
 */

export type Identidad = {
  direccion: string | null;
  plataforma: string | null;
  twitter: string | null;
  web: string | null;
};

/** CoinGecko → GoPlus. Solana no usa id numérico: tiene endpoint propio. */
const CADENAS: Record<string, string> = {
  ethereum: "1",
  "binance-smart-chain": "56",
  "polygon-pos": "137",
  "arbitrum-one": "42161",
  base: "8453",
  "optimistic-ethereum": "10",
  avalanche: "43114",
  fantom: "250",
  cronos: "25",
  "zksync": "324",
  linea: "59144",
  "polygon-zkevm": "1101",
  blast: "81457",
  scroll: "534352",
  mantle: "5000",
  opbnb: "204",
  "arbitrum-nova": "42170",
  celo: "42220",
  gnosis: "100",
  moonbeam: "1284",
  "harmony-shard-0": "1666600000",
  "okex-chain": "66",
  "huobi-token": "128",
  tron: "tron",
};

async function json(url: string, timeoutMs = 9000): Promise<unknown | null> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "centinela-panel/1.0" },
      cache: "no-store",
      signal: control.signal,
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

function texto(o: unknown, clave: string): string | null {
  if (typeof o !== "object" || o === null) return null;
  const v = (o as Record<string, unknown>)[clave];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim() !== "") {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** GoPlus devuelve los booleanos como "1"/"0" en cadena. */
function bandera(o: Record<string, unknown>, clave: string): boolean | null {
  const v = o[clave];
  if (v === "1" || v === 1 || v === true) return true;
  if (v === "0" || v === 0 || v === false) return false;
  return null;
}

// ── 1. Identidad ─────────────────────────────────────────────────────────────

export async function identidad(id: string, clave?: string): Promise<Identidad | null> {
  const url =
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id.trim().toLowerCase())}` +
    `?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`;
  const datos = await json(clave ? `${url}&x_cg_demo_api_key=${encodeURIComponent(clave)}` : url);
  if (datos === null || typeof datos !== "object") return null;

  const d = datos as Record<string, unknown>;
  const plataformas = (d.platforms ?? {}) as Record<string, unknown>;
  const conDireccion = Object.entries(plataformas).filter(
    ([, v]) => typeof v === "string" && v.trim() !== "",
  ) as [string, string][];

  // `asset_platform_id` puede faltar; entonces la cadena es la clave de la
  // dirección que sí tenemos. Sin esto quedaba una dirección huérfana y las
  // comprobaciones del contrato salían todas «sin comprobar» sin decir por qué.
  const declarada = texto(d, "asset_platform_id");
  const elegida =
    (declarada && conDireccion.find(([k]) => k === declarada)) || conDireccion[0] || null;
  const plataforma = elegida ? elegida[0] : declarada;
  const direccion = elegida ? elegida[1] : undefined;

  const links = (d.links ?? {}) as Record<string, unknown>;
  const webs = Array.isArray(links.homepage) ? links.homepage : [];
  const twitter = texto(links, "twitter_screen_name");

  return {
    direccion: direccion?.trim() || null,
    plataforma,
    twitter: twitter ? `https://twitter.com/${twitter}` : null,
    web: typeof webs[0] === "string" && webs[0].trim() ? String(webs[0]).trim() : null,
  };
}

// ── 2. DexScreener ───────────────────────────────────────────────────────────

type Mercado = { liquidezUsd: number | null; volumen24hUsd: number | null; parCreadoEn: number | null };

async function mercado(direccion: string): Promise<Mercado> {
  const vacio: Mercado = { liquidezUsd: null, volumen24hUsd: null, parCreadoEn: null };
  const datos = await json(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(direccion)}`);
  const pares = (datos as { pairs?: unknown })?.pairs;
  if (!Array.isArray(pares) || pares.length === 0) return vacio;

  // El par con más liquidez es el que de verdad marca el precio; sumar todos
  // exageraría lo que podrías mover sin afectar al mercado.
  const principal = pares
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
    .map((p) => ({ p, liq: num((p.liquidity as Record<string, unknown>)?.usd) ?? 0 }))
    .sort((a, b) => b.liq - a.liq)[0];
  if (!principal) return vacio;

  const p = principal.p;
  return {
    liquidezUsd: num((p.liquidity as Record<string, unknown>)?.usd),
    volumen24hUsd: num((p.volume as Record<string, unknown>)?.h24),
    parCreadoEn: num(p.pairCreatedAt),
  };
}

// ── 3. GoPlus ────────────────────────────────────────────────────────────────

type Contrato = Omit<DatosToken, keyof Mercado>;

/** Por qué las comprobaciones del contrato salieron como salieron. Sin esto,
 *  «9 sin comprobar» no es accionable ni para el usuario ni para arreglarlo. */
export type Fuente =
  | { tipo: "ok" }
  | { tipo: "cadena-no-soportada"; plataforma: string | null }
  | { tipo: "sin-respuesta" }
  | { tipo: "sin-contrato" };

const CONTRATO_VACIO: Contrato = {
  honeypot: null,
  puedeVenderTodo: null,
  codigoAbierto: null,
  emisionAbierta: null,
  duenoPuedeRecuperarControl: null,
  duenoPuedeCambiarSaldos: null,
  impuestoCompraPct: null,
  impuestoVentaPct: null,
  top10Pct: null,
  liquidezBloqueadaPct: null,
};

/** Suma el porcentaje de los N mayores. GoPlus los da como fracción en cadena. */
function porcentaje(lista: unknown, cuantos: number, soloBloqueados = false): number | null {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const filas = lista
    .filter((h): h is Record<string, unknown> => typeof h === "object" && h !== null)
    .map((h) => ({ pct: num(h.percent), bloqueado: h.is_locked === 1 || h.is_locked === "1" }))
    .filter((h) => h.pct !== null);
  if (filas.length === 0) return null;

  const elegidas = soloBloqueados ? filas.filter((f) => f.bloqueado) : filas.slice(0, cuantos);
  return elegidas.reduce((suma, f) => suma + (f.pct as number), 0) * 100;
}

async function contratoEvm(cadena: string, direccion: string): Promise<[Contrato, Fuente]> {
  const datos = await json(
    `https://api.gopluslabs.io/api/v1/token_security/${cadena}?contract_addresses=${encodeURIComponent(direccion)}`,
  );
  const resultado = (datos as { result?: Record<string, unknown> })?.result;
  if (!resultado || typeof resultado !== "object") return [CONTRATO_VACIO, { tipo: "sin-respuesta" }];

  // La clave viene en minúsculas, no necesariamente igual a lo que enviamos.
  const fila = Object.values(resultado).find((v) => typeof v === "object" && v !== null) as
    | Record<string, unknown>
    | undefined;
  if (!fila) return [CONTRATO_VACIO, { tipo: "sin-respuesta" }];

  const compra = num(fila.buy_tax);
  const venta = num(fila.sell_tax);

  return [{
    honeypot: bandera(fila, "is_honeypot"),
    // `cannot_sell_all` es la negación de lo que queremos afirmar.
    puedeVenderTodo: invertir(bandera(fila, "cannot_sell_all")),
    codigoAbierto: bandera(fila, "is_open_source"),
    emisionAbierta: bandera(fila, "is_mintable"),
    duenoPuedeRecuperarControl: bandera(fila, "can_take_back_ownership"),
    duenoPuedeCambiarSaldos: bandera(fila, "owner_change_balance"),
    impuestoCompraPct: compra === null ? null : compra * 100,
    impuestoVentaPct: venta === null ? null : venta * 100,
    top10Pct: porcentaje(fila.holders, 10),
    liquidezBloqueadaPct: porcentaje(fila.lp_holders, 0, true),
  }, { tipo: "ok" }];
}

async function contratoSolana(direccion: string): Promise<[Contrato, Fuente]> {
  const datos = await json(
    `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(direccion)}`,
  );
  const resultado = (datos as { result?: Record<string, unknown> })?.result;
  const fila = resultado
    ? (Object.values(resultado).find((v) => typeof v === "object" && v !== null) as Record<string, unknown> | undefined)
    : undefined;
  if (!fila) return [CONTRATO_VACIO, { tipo: "sin-respuesta" }];

  // En Solana el vocabulario es otro: no hay «dueño del contrato» sino
  // autoridades sobre el token. Lo que no tenga equivalente se queda en null,
  // que la revisión enseñará como desconocido en vez de como aprobado.
  const congelable = autoridad(fila.freezable);
  const emisible = autoridad(fila.mintable);
  const saldoMutable = autoridad(fila.balance_mutable_authority);

  return [{
    ...CONTRATO_VACIO,
    // Poder congelar tu cuenta es, en la práctica, poder impedirte vender.
    honeypot: congelable,
    puedeVenderTodo: invertir(autoridad(fila.non_transferable)),
    emisionAbierta: emisible,
    duenoPuedeCambiarSaldos: saldoMutable,
    top10Pct: porcentaje(fila.holders, 10),
    liquidezBloqueadaPct: porcentaje((fila.lp_holders as unknown) ?? null, 0, true),
  }, { tipo: "ok" }];
}

/** En el endpoint de Solana cada riesgo viene como `{status: "1"|"0"}`. */
function autoridad(valor: unknown): boolean | null {
  if (typeof valor === "object" && valor !== null) return bandera(valor as Record<string, unknown>, "status");
  if (valor === "1" || valor === 1) return true;
  if (valor === "0" || valor === 0) return false;
  return null;
}

function invertir(valor: boolean | null): boolean | null {
  return valor === null ? null : !valor;
}

// ── Orquestación ─────────────────────────────────────────────────────────────

export type Revisado = { identidad: Identidad; datos: DatosToken; fuente: Fuente };

export async function revisarToken(id: string): Promise<Revisado | { error: string }> {
  const clave = process.env.COINGECKO_DEMO_KEY?.trim();
  const ident = await identidad(id, clave);
  if (ident === null) return { error: `CoinGecko no conoce «${id}», o está limitando las peticiones.` };
  if (!ident.direccion) {
    return {
      error:
        `CoinGecko no publica la dirección del contrato de «${id}». Suele pasar con las monedas ` +
        `que tienen cadena propia (Bitcoin, XRP): ahí esta revisión no aplica, porque no hay ` +
        `contrato que revisar.`,
    };
  }

  const cadena = ident.plataforma ? CADENAS[ident.plataforma] : undefined;
  const esSolana = ident.plataforma === "solana";

  // En paralelo: son dos servicios distintos y ninguno depende del otro.
  const [datosMercado, [datosContrato, fuente]] = await Promise.all([
    mercado(ident.direccion),
    esSolana
      ? contratoSolana(ident.direccion)
      : cadena
        ? contratoEvm(cadena, ident.direccion)
        : Promise.resolve<[Contrato, Fuente]>([
            CONTRATO_VACIO,
            { tipo: "cadena-no-soportada", plataforma: ident.plataforma },
          ]),
  ]);

  return { identidad: ident, datos: { ...datosContrato, ...datosMercado }, fuente };
}
