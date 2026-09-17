import "server-only";

/**
 * Búsqueda y datos históricos de CoinGecko.
 *
 * Lo llama el servidor del panel, no el navegador: así la clave (si la hay) no
 * sale de Vercel y no hay que pelearse con CORS.
 *
 * Las mismas convenciones que el proveedor del bot, que lleva semanas
 * funcionando: `api.coingecko.com`, cabecera `x-cg-demo-api-key` solo si hay
 * clave, y modo sin clave como camino normal.
 */

const BASE = "https://api.coingecko.com/api/v3";

export class CoinGeckoCaido extends Error {}

function cabeceras(): Record<string, string> {
  const clave = process.env.COINGECKO_DEMO_KEY?.trim();
  return {
    accept: "application/json",
    "user-agent": "centinela-panel/1.0",
    ...(clave ? { "x-cg-demo-api-key": clave } : {}),
  };
}

async function pedir(ruta: string): Promise<unknown> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, { headers: cabeceras(), cache: "no-store" });
  } catch (error) {
    throw new CoinGeckoCaido(
      `No se pudo contactar con CoinGecko: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Sin clave el límite es por IP y lo comparte medio mundo. Decirlo por su
  // nombre evita que parezca que la moneda no existe.
  if (respuesta.status === 429) {
    throw new CoinGeckoCaido(
      "CoinGecko está limitando las peticiones (sin clave el límite es por IP). Espera un minuto y prueba otra vez.",
    );
  }
  if (!respuesta.ok) {
    throw new CoinGeckoCaido(`CoinGecko respondió ${respuesta.status}.`);
  }

  try {
    return await respuesta.json();
  } catch {
    throw new CoinGeckoCaido("CoinGecko devolvió algo que no es JSON.");
  }
}

// ── Búsqueda ─────────────────────────────────────────────────────────────────

export type Moneda = {
  /** El id exacto que hay que escribir en la configuración. Es lo que se copia
   *  mal cuando se teclea a mano, y por eso aquí se elige en vez de escribirse. */
  id: string;
  nombre: string;
  ticker: string;
  /** Posición por capitalización. `null` en las monedas diminutas, que es
   *  precisamente la señal de que puede ser una copia del nombre famoso. */
  rango: number | null;
  imagen: string | null;
};

/** Lee un campo sin dar por hecho que el proveedor no cambia nunca de forma. */
function texto(objeto: Record<string, unknown>, clave: string): string {
  const valor = objeto[clave];
  return typeof valor === "string" ? valor : "";
}

function numeroOnulo(objeto: Record<string, unknown>, clave: string): number | null {
  const valor = objeto[clave];
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

export async function buscarMonedas(consulta: string, limite = 12): Promise<Moneda[]> {
  const termino = consulta.trim();
  if (termino.length < 2) return [];

  const datos = await pedir(`/search?query=${encodeURIComponent(termino)}`);
  const lista = (datos as { coins?: unknown })?.coins;
  if (!Array.isArray(lista)) return [];

  return lista
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      id: texto(c, "id"),
      nombre: texto(c, "name"),
      ticker: texto(c, "symbol").toUpperCase(),
      rango: numeroOnulo(c, "market_cap_rank"),
      imagen: texto(c, "thumb") || texto(c, "large") || null,
    }))
    .filter((m) => m.id !== "")
    .slice(0, limite);
}

// ── Historial ────────────────────────────────────────────────────────────────

export type Historial = { puntos: { t: number; precio: number }[]; divisa: string };

/**
 * Precios de los últimos `dias`. CoinGecko decide el grano según la ventana
 * (horario para una semana), así que no se asume ninguno: la serie se mide por
 * sus marcas de tiempo.
 */
export async function historial(id: string, divisa = "usd", dias = 7): Promise<Historial> {
  const ruta =
    `/coins/${encodeURIComponent(id.trim().toLowerCase())}/market_chart` +
    `?vs_currency=${encodeURIComponent(divisa.toLowerCase())}&days=${dias}`;

  const datos = await pedir(ruta);
  const crudo = (datos as { prices?: unknown })?.prices;
  if (!Array.isArray(crudo)) {
    throw new CoinGeckoCaido(`CoinGecko no devolvió precios para «${id}». ¿Es correcto ese id?`);
  }

  const puntos = crudo
    .filter((par): par is [number, number] => Array.isArray(par) && par.length >= 2)
    .map(([t, precio]) => ({ t: Number(t), precio: Number(precio) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.precio) && p.precio > 0);

  if (puntos.length < 2) {
    throw new CoinGeckoCaido(
      `CoinGecko solo tiene ${puntos.length} precio(s) de «${id}» en ${dias} días: no da para calcular nada.`,
    );
  }

  return { puntos, divisa: divisa.toLowerCase() };
}
