import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
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
beforeEach(() => vi.resetModules());

describe("llamada a las funciones Python", () => {
  it("un 200 con HTML dice qué página es, no solo que es HTML", async () => {
    // "Es HTML" no basta para saber dónde mirar: la pantalla de Vercel, el
    // desafío del firewall y un 404 llegan las tres igual.
    responder("<!DOCTYPE html><html><body>Authentication Required</body></html>", {});
    await expect(callPython("/api/validate", {})).rejects.toThrow(/Protección de Despliegue/);
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

describe("a qué URL se llama", () => {
  const guardado = { ...process.env };
  afterEach(() => {
    process.env = { ...guardado };
  });

  it("PANEL_BASE_URL gana sobre las variables de Vercel", async () => {
    // Estaba de última, detrás de VERCEL_URL, que en Vercel siempre existe: la
    // variable que sirve para corregir el destino no podía corregir nada.
    process.env.PANEL_BASE_URL = "https://mi-dominio.vercel.app";
    process.env.VERCEL_URL = "despliegue-abc123.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "produccion.vercel.app";

    const { baseUrl } = await import("../lib/internal");
    expect(baseUrl()).toBe("https://mi-dominio.vercel.app");
  });

  it("le quita la barra final para no pedir //api/validate", async () => {
    process.env.PANEL_BASE_URL = "https://mi-dominio.vercel.app/";
    const { baseUrl } = await import("../lib/internal");
    expect(baseUrl()).toBe("https://mi-dominio.vercel.app");
  });

  it("sin override, el dominio de producción gana a la URL del despliegue", async () => {
    delete process.env.PANEL_BASE_URL;
    process.env.VERCEL_URL = "despliegue-abc123.vercel.app";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "produccion.vercel.app";

    const { baseUrl } = await import("../lib/internal");
    expect(baseUrl()).toBe("https://produccion.vercel.app");
  });
});

describe("qué página HTML nos devolvieron", () => {
  function htmlCon(titulo: string, cuerpo = "") {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(`<!DOCTYPE html><html><head><title>${titulo}</title></head><body>${cuerpo}</body></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    ));
  }

  it("reconoce la pantalla de autenticación de Vercel", async () => {
    htmlCon("Authentication Required");
    await expect(callPython("/api/probe", {})).rejects.toThrow(/Protección de Despliegue/);
  });

  it("reconoce el desafío del firewall", async () => {
    htmlCon("Just a moment...");
    await expect(callPython("/api/probe", {})).rejects.toThrow(/Attack Challenge Mode/);
  });

  it("reconoce un 404", async () => {
    htmlCon("404: This page could not be found");
    await expect(callPython("/api/probe", {})).rejects.toThrow(/no está desplegada/);
  });

  it("si no reconoce la página, dice cómo averiguarlo", async () => {
    htmlCon("Algo inesperado");
    // callPython es genérico sin default, así que el await es `unknown`.
    const error = (await callPython("/api/probe", {}).catch((e: unknown) => e)) as Error;
    expect(error.message).toContain('se titula "Algo inesperado"');
    expect(error.message).toMatch(/Ábrela en el navegador/);
  });
});

describe("cabeceras de la llamada interna", () => {
  it("se identifica en vez de parecer un bot anónimo", async () => {
    const espia = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", espia);
    process.env.INTERNAL_API_TOKEN = "secreto";

    const { callPython } = await import("../lib/internal");
    await callPython("/api/probe", {});

    const [, init] = espia.mock.calls[0] ?? [];
    const enviadas = (init?.headers ?? {}) as Record<string, string>;
    expect(enviadas["user-agent"]).toMatch(/centinela-panel/);
    expect(enviadas.accept).toBe("application/json");
    expect(enviadas["x-panel-token"]).toBe("secreto");
  });
});
