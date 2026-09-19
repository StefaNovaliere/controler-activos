import { clasificar } from "./mercado";

/**
 * La zona que corresponde a lo que se está viendo en pantalla.
 *
 * Módulo PURO.
 *
 * El bot guarda la zona en su estado, pero esa zona la calculó con la
 * configuración que había EN SU MOMENTO. Entre que alguien cambia un umbral y
 * el cron vuelve a evaluar pasan hasta quince minutos, y durante ese rato la
 * etiqueta guardada describe una configuración distinta de la que está escrita
 * dos líneas más abajo: XRP a 1,43 con el aviso de subida en 1,50 y el cartel
 * diciendo «por encima».
 *
 * El bot no está equivocado —detecta el cambio de configuración y reclasifica
 * desde cero en la ejecución siguiente—, pero el panel no puede enseñar una
 * conclusión vieja pegada a unos números nuevos. Así que la recalcula con lo que
 * tiene delante, con `clasificar()`, que es la misma regla del motor y está
 * verificada contra él en schema/alert_cases.json.
 */
export type ZonaVista =
  | { tipo: "pausa" }
  | { tipo: "sin-datos" }
  /** Sin umbrales fijos no hay «rango» del que estar dentro o fuera. */
  | { tipo: "sin-rango" }
  | { tipo: "zona"; zona: "below" | "inside" | "above" };

export function zonaVista(
  precio: number | null,
  lower: number | null,
  upper: number | null,
  previa: "below" | "inside" | "above" | null | undefined,
  habilitado: boolean,
  histeresisPct = 0.25,
): ZonaVista {
  if (!habilitado) return { tipo: "pausa" };
  if (precio === null) return { tipo: "sin-datos" };
  if (lower === null && upper === null) return { tipo: "sin-rango" };

  // La zona previa entra como entra en el bot: la histéresis solo retiene el
  // estado anterior si el precio sigue rozando el umbral, así que un umbral
  // movido de verdad da la zona nueva igualmente.
  return { tipo: "zona", zona: clasificar(precio, lower, upper, previa ?? null, histeresisPct) };
}

export function etiquetaZona(v: ZonaVista): string {
  switch (v.tipo) {
    case "pausa":
      return "en pausa";
    case "sin-datos":
      return "sin datos aún";
    case "sin-rango":
      // Un activo que solo vigila giros no está «dentro del rango»: no hay
      // rango. Decirlo era tan falso como el cartel que este módulo arregla.
      return "vigilando";
    case "zona":
      return { below: "por debajo", inside: "dentro del rango", above: "por encima" }[v.zona];
  }
}

export function claseZona(v: ZonaVista): string {
  return v.tipo === "zona" ? `zone zone-${v.zona}` : "zone zone-none";
}
