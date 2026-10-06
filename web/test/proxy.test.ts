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

describe("volver a donde se iba después del login", () => {
  it("el enlace de Telegram conserva el activo y el aviso", async () => {
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../proxy");
    const r = await proxy(new NextRequest("https://panel.example.app/diario?activo=pepe&aviso=TRAILING_DROP"));
    const destino = new URL(r.headers.get("location")!);
    expect(destino.pathname).toBe("/login");
    expect(destino.searchParams.get("next")).toBe("/diario?activo=pepe&aviso=TRAILING_DROP");
  });

  it("solo vuelve a rutas internas: nada de redirect abierto", async () => {
    const { destinoSeguro } = await import("../lib/destino");
    expect(destinoSeguro("/diario?activo=pepe&aviso=BREACH_LOWER")).toBe("/diario?activo=pepe&aviso=BREACH_LOWER");
    for (const malo of ["https://otro.com", "//otro.com", "/\\otro.com", "javascript:alert(1)", "", null, "/login", "/x\n"]) {
      expect(destinoSeguro(malo)).toBe("/");
    }
  });
});
