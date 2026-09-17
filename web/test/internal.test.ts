import { describe, expect, it, vi, afterEach } from "vitest";
import { callPython } from "../lib/internal";

/** Todos estos casos daban antes el mismo "Unexpected token '<'", que no dice
 *  dónde mirar. El valor de estos tests es que el mensaje sea accionable. */
function responder(body: string, init: { status?: number; type?: string }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(body, {
        status: init.status ?? 200,
        headers: { "content-type": init.type ?? "text/html" },
      }),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("llamada a las funciones Python", () => {
  it("un 200 con HTML explica que la petición no llegó a la función", async () => {
    responder("<!DOCTYPE html><html><body>Authentication Required</body></html>", {});
    await expect(callPython("/api/validate", {})).rejects.toThrow(/no llegó a la función Python/);
  });

  it("un 401 con nuestro cuerpo señala el token interno", async () => {
    responder('{"ok":false,"errors":["no autorizado"]}', { status: 401, type: "application/json" });
    await expect(callPython("/api/validate", {})).rejects.toThrow(/INTERNAL_API_TOKEN/);
  });

  it("un 401 sin nuestro cuerpo señala la protección de Vercel", async () => {
    responder("<html>SSO</html>", { status: 401 });
    await expect(callPython("/api/validate", {})).rejects.toThrow(/Protección de Despliegue/);
  });

  it("un 404 señala el ajuste del Root Directory", async () => {
    responder("<html>404</html>", { status: 404 });
    await expect(callPython("/api/validate", {})).rejects.toThrow(/Root Directory/);
  });

  it("una respuesta JSON correcta se devuelve tal cual", async () => {
    responder('{"ok":true,"assets":[]}', { type: "application/json" });
    await expect(callPython("/api/validate", {})).resolves.toEqual({ ok: true, assets: [] });
  });
});
