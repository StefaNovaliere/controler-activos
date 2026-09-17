import { describe, expect, it } from "vitest";
import { config } from "../proxy";

/**
 * El matcher decide qué rutas pasan por el login. Tenía a `/api/` dentro, y eso
 * rompía el panel de una forma que no se veía: las funciones Python las llama el
 * servidor, sin cookie, así que el proxy las redirigía a /login, `fetch` seguía
 * la redirección y el panel recibía 200 con su propia página HTML en vez de
 * JSON. Desde el navegador funcionaba, porque el navegador sí lleva cookie.
 */
function protege(ruta: string): boolean {
  const patrones = config.matcher.map((m) => new RegExp(`^${m}$`));
  return patrones.some((p) => p.test(ruta));
}

describe("qué rutas intercepta el proxy", () => {
  it("NO intercepta las funciones Python: se autentican con x-panel-token", () => {
    expect(protege("/api/probe")).toBe(false);
    expect(protege("/api/validate")).toBe(false);
  });

  it("NO intercepta el despertador: lo llama un cron externo, sin sesión", () => {
    expect(protege("/api/latido")).toBe(false);
  });

  it("sigue protegiendo el panel", () => {
    expect(protege("/")).toBe(true);
    expect(protege("/activos")).toBe(true);
  });

  it("deja pasar el login y los estáticos, o no se podría ni entrar", () => {
    expect(protege("/login")).toBe(false);
    expect(protege("/_next/static/chunk.js")).toBe(false);
    expect(protege("/favicon.ico")).toBe(false);
  });
});
