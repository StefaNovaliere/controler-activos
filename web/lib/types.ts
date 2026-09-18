/** Un activo tal y como lo maneja el panel. Los números viajan como cadena:
 *  el navegador emite texto y pydantic acepta `lower: "55000"` sin problema.
 *  Convertirlos a `number` de JavaScript solo introduciría errores de coma
 *  flotante en valores que el bot compara con Decimal. */
export type AssetInput = {
  id: string;
  label: string;
  provider: string;
  symbol: string;
  currency: string;
  lower: string | null;
  upper: string | null;
  enabled: boolean;
  cooldown_minutes?: number | null;
  hysteresis_pct?: string | null;
  notify_on_return?: boolean | null;
  renotify_while_outside?: boolean | null;
  max_staleness_minutes?: number | null;
  fallback?: { provider: string; symbol: string } | null;
  /** Aviso relativo a un extremo: «cae un X % desde su máximo». Contesta «¿se
   *  dio la vuelta?», que es otra pregunta que «¿llegó a este precio?». */
  trailing?: { drop_pct: string | null; rise_pct: string | null } | null;
  /** Plan de salida por tramos: a este precio, vendo esta parte. */
  exits?: { price: string; sell_pct: string | null; note: string | null }[];
  /** A cuánto compraste. Deja que el panel hable en múltiplos en vez de en
   *  precios sueltos. Opcional. */
  entry_price?: string | null;
};

export type Zone = "below" | "inside" | "above";

export type AssetState = {
  zone: Zone | null;
  last_price?: string;
  last_ok_at?: string;
  last_notified_event?: string;
  pending?: { kind: string; first_seen_at: string; first_price: string } | null;
  consecutive_failures: number;
  last_error?: string | null;
  config_fingerprint?: string;
  /** Máximo y mínimo que el bot lleva siguiendo. El umbral de trailing NO es un
   *  número fijo: sale de estos, así que sin ellos no se puede dibujar. */
  peak?: string;
  trough?: string;
  highest_exit?: string;
};

export type StateFile = {
  schema: number;
  updated_at: string;
  assets: Record<string, AssetState>;
};

/** Lo que devuelve `/api/validate`: el veredicto del pydantic de verdad. */
export type Verdict =
  | { ok: true; assets: ResolvedAsset[] }
  | { ok: false; errors: string[] };

export type ResolvedAsset = {
  id: string;
  label: string;
  provider: string;
  symbol: string;
  currency: string;
  lower: string | null;
  upper: string | null;
  cooldown_minutes: number;
  fingerprint: string;
};
