import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyAssets, declaredProviders, readAssets } from "../lib/yaml";

/** Fixture fija con la forma del fichero original, comentarios incluidos.
 *
 *  NO se usa `config/assets.yml` para estas aserciones: ese fichero es del
 *  usuario y cambia cada vez que toca el panel, así que atar los tests a sus
 *  activos pone CI en rojo por el mero hecho de usar el producto. */
const EJEMPLO = `# Centinela de precios — edita SOLO este fichero.
version: 1

defaults:
  currency: usd
  cooldown_minutes: 180 # silencio mínimo entre mensajes del MISMO activo

providers:
  coingecko:
    api_key_env: COINGECKO_DEMO_KEY # opcional: sin ella funciona en modo keyless
  twelvedata:
    api_key_env: TWELVEDATA_API_KEY
  stooq: {} # sin clave

assets:
  - id: btc
    label: "Bitcoin"
    provider: coingecko
    symbol: bitcoin # id de CoinGecko, no el ticker
    currency: usd
    lower: 55000
    upper: 95000
    fallback:
      provider: stooq
      symbol: btcusd

  - id: aapl
    label: "Apple (AAPL)"
    provider: twelvedata
    symbol: AAPL
    currency: usd
    lower: 180
    upper: 260
    max_staleness_minutes: 5760 # 4 días: cubre fin de semana largo

  - id: brent
    label: "Petróleo Brent"
    provider: stooq
    symbol: cb.f
    currency: usd
    lower: 55
    upper: 95
    enabled: false # desactivado sin perder la configuración
`;

const REAL = readFileSync(join(__dirname, "../../config/assets.yml"), "utf8");

describe("escritura del YAML", () => {
  it("una ida y vuelta sin cambios no toca el fichero", () => {
    // Es LA prueba que importa: si falla, el primer guardado del panel borra
    // todos los comentarios del fichero con un diff ilegible.
    expect(applyAssets(EJEMPLO, readAssets(EJEMPLO))).toBe(EJEMPLO);
  });

  it("conserva los comentarios al cambiar un umbral", () => {
    const assets = readAssets(EJEMPLO);
    assets.find((a) => a.id === "btc")!.lower = "50000";

    const out = applyAssets(EJEMPLO, assets);
    expect(out).toContain("# id de CoinGecko, no el ticker");
    expect(out).toContain("# 4 días: cubre fin de semana largo");
    expect(out).toContain("lower: 50000");
  });

  it("escribe los números sin comillas", () => {
    const assets = readAssets(EJEMPLO);
    assets.find((a) => a.id === "btc")!.lower = "57000";
    expect(applyAssets(EJEMPLO, assets)).toContain("lower: 57000");
    expect(applyAssets(EJEMPLO, assets)).not.toContain('lower: "57000"');
  });

  it("escribe upper: null explícito cuando solo se vigila la caída", () => {
    const assets = readAssets(EJEMPLO);
    assets.find((a) => a.id === "btc")!.upper = null;
    expect(applyAssets(EJEMPLO, assets)).toContain("upper: null");
  });

  it("pausar es enabled: false y conserva los umbrales", () => {
    const assets = readAssets(EJEMPLO);
    assets.find((a) => a.id === "aapl")!.enabled = false;

    const out = applyAssets(EJEMPLO, assets);
    expect(readAssets(out).find((a) => a.id === "aapl")!.enabled).toBe(false);
    expect(readAssets(out).find((a) => a.id === "aapl")!.lower).toBe("180");
  });

  it("lee los activos pausados sin perderlos", () => {
    expect(readAssets(EJEMPLO).find((a) => a.id === "brent")?.enabled).toBe(false);
  });

  it("lee el proveedor de respaldo", () => {
    expect(readAssets(EJEMPLO).find((a) => a.id === "btc")?.fallback).toEqual({
      provider: "stooq",
      symbol: "btcusd",
    });
  });

  it("borrar un activo lo quita de la lista", () => {
    const assets = readAssets(EJEMPLO).filter((a) => a.id !== "aapl");
    expect(readAssets(applyAssets(EJEMPLO, assets)).map((a) => a.id)).not.toContain("aapl");
  });

  it("lee los proveedores declarados", () => {
    expect(declaredProviders(EJEMPLO).sort()).toEqual(["coingecko", "stooq", "twelvedata"]);
  });
});

describe("el fichero real del repositorio", () => {
  // Aquí SÍ se usa el fichero del usuario, pero sin mirar qué activos lleva:
  // solo que el panel puede releerlo y reescribirlo sin estropearlo.
  it("se puede leer", () => {
    expect(readAssets(REAL).length).toBeGreaterThan(0);
  });

  it("guardar sin cambios lo deja byte a byte idéntico", () => {
    expect(applyAssets(REAL, readAssets(REAL))).toBe(REAL);
  });
});
