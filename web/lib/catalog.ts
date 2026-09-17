import catalogFile from "../data/catalog.json";

export type CatalogItem = {
  key: string;
  name: string;
  kind: string;
  aliases: string[];
  suggested_id: string;
  primary: { provider: string; symbol: string };
  fallback?: { provider: string; symbol: string };
  currencies: string[];
  overrides?: Record<string, string | number>;
  note?: string;
};

export const CATALOG: CatalogItem[] = catalogFile.items as CatalogItem[];

/** Búsqueda tolerante: por nombre, por alias o por símbolo. */
export function searchCatalog(query: string, limit = 8): CatalogItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return CATALOG.slice(0, limit);

  const scored = CATALOG.map((item) => {
    const name = item.name.toLowerCase();
    let score = 0;
    if (name === needle || item.aliases.includes(needle)) score = 100;
    else if (name.startsWith(needle)) score = 80;
    else if (item.aliases.some((a) => a.startsWith(needle))) score = 70;
    else if (name.includes(needle)) score = 50;
    else if (item.primary.symbol.toLowerCase().includes(needle)) score = 40;
    return { item, score };
  }).filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map((entry) => entry.item);
}
