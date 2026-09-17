import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyAssets, declaredProviders, readAssets } from "../lib/yaml";

const REAL = readFileSync(join(__dirname, "../../config/assets.yml"), "utf8");

describe("escritura del YAML", () => {
  it("una ida y vuelta sin cambios no toca el fichero", () => {
    // Es LA prueba que importa: si falla, el primer guardado del panel borra
    // todos los comentarios del fichero con un diff ilegible.
    expect(applyAssets(REAL, readAssets(REAL))).toBe(REAL);
  });

  it("conserva los comentarios al cambiar un umbral", () => {
    const assets = readAssets(REAL);
    const btc = assets.find((a) => a.id === "btc")!;
    btc.lower = "50000";

    const out = applyAssets(REAL, assets);
    expect(out).toContain("# id de CoinGecko, no el ticker");
    expect(out).toContain("# 4 días: cubre fin de semana largo con el mercado cerrado");
    expect(out).toContain("lower: 50000");
  });

  it("escribe los números sin comillas", () => {
    const assets = readAssets(REAL);
    assets.find((a) => a.id === "btc")!.lower = "57000";
    expect(applyAssets(REAL, assets)).toContain("lower: 57000");
    expect(applyAssets(REAL, assets)).not.toContain('lower: "57000"');
  });

  it("escribe upper: null explícito cuando solo se vigila la caída", () => {
    const assets = readAssets(REAL);
    assets.find((a) => a.id === "btc")!.upper = null;
    expect(applyAssets(REAL, assets)).toContain("upper: null");
  });

  it("pausar es enabled: false y conserva los umbrales", () => {
    const assets = readAssets(REAL);
    assets.find((a) => a.id === "btc")!.enabled = false;

    const out = applyAssets(REAL, assets);
    expect(out).toContain("enabled: false");
    expect(readAssets(out).find((a) => a.id === "btc")!.lower).toBe("55000");
  });

  it("lee los activos pausados sin perderlos", () => {
    const brent = readAssets(REAL).find((a) => a.id === "brent");
    expect(brent?.enabled).toBe(false);
  });

  it("lee el respaldo de las criptos", () => {
    const btc = readAssets(REAL).find((a) => a.id === "btc");
    expect(btc?.fallback).toEqual({ provider: "stooq", symbol: "btcusd" });
  });

  it("borrar un activo lo quita de la lista", () => {
    const assets = readAssets(REAL).filter((a) => a.id !== "eurusd");
    expect(readAssets(applyAssets(REAL, assets)).map((a) => a.id)).not.toContain("eurusd");
  });

  it("lee los proveedores declarados", () => {
    expect(declaredProviders(REAL).sort()).toEqual(["coingecko", "stooq", "twelvedata"]);
  });
});
