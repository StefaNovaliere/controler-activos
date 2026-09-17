import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

/** El cuerpo que se manda a la API de GitHub al guardar. */
async function capturarCuerpo(): Promise<Record<string, unknown>> {
  const espia = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ commit: { sha: "abc", html_url: "http://x" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", espia);

  const { saveConfig } = await import("../lib/github");
  await saveConfig("version: 1\n", "sha-previo", "config(panel): prueba");

  const [, init] = espia.mock.calls[0] ?? [];
  return JSON.parse(String(init?.body));
}

describe("escritura en GitHub", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GITHUB_TOKEN = "t";
    process.env.GITHUB_REPO = "duenyo/repo";
    process.env.GITHUB_BRANCH = "main";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("no inventa un committer", async () => {
    // `nombre@users.noreply.github.com` es un formato reservado de GitHub y
    // resuelve al usuario real con ese nombre: inventarlo atribuye los commits
    // a un desconocido. Sin el campo, GitHub usa al dueño del token.
    const cuerpo = await capturarCuerpo();
    expect(cuerpo).not.toHaveProperty("committer");
    expect(cuerpo).not.toHaveProperty("author");
    expect(JSON.stringify(cuerpo)).not.toContain("users.noreply.github.com");
  });

  it("manda el sha previo, para no pisar cambios ajenos", async () => {
    expect(await capturarCuerpo()).toMatchObject({ sha: "sha-previo", branch: "main" });
  });

  it("el mensaje identifica que el cambio viene del panel", async () => {
    expect((await capturarCuerpo()).message).toBe("config(panel): prueba");
  });
});
