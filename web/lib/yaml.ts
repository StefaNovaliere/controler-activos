import YAML from "yaml";
import type { AssetInput } from "./types";

/**
 * Reescribe la lista de activos conservando el resto del fichero.
 *
 * `config/assets.yml` está lleno de comentarios explicativos — "el id de
 * CoinGecko, no el ticker", "4 días: cubre fin de semana largo" — que son su
 * única documentación in situ. Un `YAML.stringify(objeto)` los borraría todos en
 * el primer guardado, con un diff ilegible. `parseDocument` los conserva, y
 * reutilizar el nodo existente cuando coincide el `id` hace que sobrevivan
 * también los comentarios de cada activo.
 */
export function applyAssets(originalText: string, assets: AssetInput[]): string {
  const doc = YAML.parseDocument(originalText);
  const seq = doc.get("assets") as YAML.YAMLSeq | undefined;
  if (!seq || !YAML.isSeq(seq)) {
    throw new Error("config/assets.yml no tiene una lista 'assets'");
  }

  const existing = new Map<string, YAML.YAMLMap>();
  for (const item of seq.items as YAML.YAMLMap[]) {
    if (YAML.isMap(item)) {
      const id = item.get("id");
      if (typeof id === "string") existing.set(id, item);
    }
  }

  seq.items = assets.map((asset) => {
    const node = existing.get(asset.id) ?? (doc.createNode({}) as YAML.YAMLMap);

    setText(node, "id", asset.id);
    setText(node, "label", asset.label);
    setText(node, "provider", asset.provider);
    setText(node, "symbol", asset.symbol);
    setText(node, "currency", asset.currency);

    // `upper: null` es una configuración legítima (vigilar solo la caída), así
    // que se escribe explícito en vez de omitir la clave.
    setNumber(node, "lower", asset.lower);
    setNumber(node, "upper", asset.upper);

    setOptionalInt(node, "cooldown_minutes", asset.cooldown_minutes);
    setOptionalNumber(node, "hysteresis_pct", asset.hysteresis_pct);
    setOptionalBool(node, "notify_on_return", asset.notify_on_return);
    setOptionalBool(node, "renotify_while_outside", asset.renotify_while_outside);
    setOptionalInt(node, "max_staleness_minutes", asset.max_staleness_minutes);

    if (asset.fallback) {
      const fallback = (node.get("fallback") as YAML.YAMLMap) ?? (doc.createNode({}) as YAML.YAMLMap);
      setText(fallback, "provider", asset.fallback.provider);
      setText(fallback, "symbol", asset.fallback.symbol);
      node.set("fallback", fallback);
    } else {
      node.delete("fallback");
    }

    // Pausar es `enabled: false`; lo normal es no escribir la clave.
    if (asset.enabled) node.delete("enabled");
    else node.set("enabled", false);

    return node;
  });

  return doc.toString({ lineWidth: 0, nullStr: "null" });
}

/** Los proveedores declarados en el fichero, para las comprobaciones cruzadas. */
export function declaredProviders(text: string): string[] {
  const doc = YAML.parseDocument(text);
  const providers = doc.get("providers");
  return YAML.isMap(providers)
    ? providers.items.map((pair) => String((pair.key as YAML.Scalar)?.value ?? pair.key))
    : [];
}

function setText(node: YAML.YAMLMap, key: string, value: string | null | undefined) {
  if (value === null || value === undefined || value === "") node.delete(key);
  else node.set(key, value);
}

/**
 * Escribe el número sin comillas: `lower: 55000`, no `lower: "55000"`.
 *
 * Los umbrales viajan como cadena por el panel para no pasarlos por el coma
 * flotante de JavaScript. Al escribirlos, si la cadena sobrevive intacta a un
 * viaje de ida y vuelta por `Number` se emite como número; si no (notación
 * científica, ceros de más, precisión extrema), se deja como cadena, que pydantic
 * también acepta. Así el fichero se lee bien y ningún valor se deforma.
 */
function setNumber(node: YAML.YAMLMap, key: string, value: string | null) {
  if (value === null || value === "") {
    node.set(key, null);
    return;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && String(parsed) === value.trim()) node.set(key, parsed);
  else node.set(key, value);
}

function setOptionalNumber(node: YAML.YAMLMap, key: string, value: string | null | undefined) {
  if (value === null || value === undefined || value === "") node.delete(key);
  else setNumber(node, key, value);
}

function setOptionalInt(node: YAML.YAMLMap, key: string, value: number | null | undefined) {
  if (value === null || value === undefined) node.delete(key);
  else node.set(key, value);
}

function setOptionalBool(node: YAML.YAMLMap, key: string, value: boolean | null | undefined) {
  if (value === null || value === undefined) node.delete(key);
  else node.set(key, value);
}

/** Lee los activos del YAML para rellenar el formulario. */
export function readAssets(text: string): AssetInput[] {
  const doc = YAML.parseDocument(text);
  const seq = doc.get("assets") as YAML.YAMLSeq | undefined;
  if (!seq || !YAML.isSeq(seq)) return [];

  return (seq.items as YAML.YAMLMap[]).filter(YAML.isMap).map((item) => {
    const fallback = item.get("fallback") as YAML.YAMLMap | undefined;
    return {
      id: String(item.get("id") ?? ""),
      label: optionalString(item.get("label")) ?? "",
      provider: String(item.get("provider") ?? ""),
      symbol: String(item.get("symbol") ?? ""),
      currency: optionalString(item.get("currency")) ?? "",
      lower: optionalString(item.get("lower")),
      upper: optionalString(item.get("upper")),
      enabled: item.get("enabled") !== false,
      cooldown_minutes: optionalNumber(item.get("cooldown_minutes")),
      hysteresis_pct: optionalString(item.get("hysteresis_pct")),
      notify_on_return: optionalBool(item.get("notify_on_return")),
      renotify_while_outside: optionalBool(item.get("renotify_while_outside")),
      max_staleness_minutes: optionalNumber(item.get("max_staleness_minutes")),
      fallback: YAML.isMap(fallback)
        ? { provider: String(fallback.get("provider") ?? ""), symbol: String(fallback.get("symbol") ?? "") }
        : null,
    };
  });
}

function optionalString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function optionalNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function optionalBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
