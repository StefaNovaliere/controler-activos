import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Respuestas encadenadas de la API de GitHub: la primera es la consulta de la
 *  última ejecución, la segunda el disparo. */
function githubResponde(...respuestas: Response[]) {
  const espia = vi.fn(
    async (_url: string | URL, _init?: RequestInit) =>
      respuestas.shift() ?? new Response(null, { status: 500 }),
  );
  vi.stubGlobal("fetch", espia);
  return espia;
}

function runsHace(minutos: number | null): Response {
  const runs =
    minutos === null
      ? []
      : [{ created_at: new Date(Date.now() - minutos * 60_000).toISOString() }];
  return new Response(JSON.stringify({ workflow_runs: runs }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pedir(clave?: string) {
  const url = new URL("https://panel.vercel.app/api/latido");
  if (clave !== undefined) url.searchParams.set("clave", clave);
  return new NextRequest(url);
}

describe("el despertador del centinela", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GITHUB_TOKEN = "t";
    process.env.GITHUB_REPO = "duenyo/repo";
    process.env.GITHUB_BRANCH = "main";
    process.env.LATIDO_TOKEN = "clave-larga-de-verdad";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sin LATIDO_TOKEN no dispara nada, aunque le pidan", async () => {
    // Una ruta que lanza workflows sin autenticar es una invitación. Que falle
    // ruidosamente es preferible a que quede abierta por descuido.
    delete process.env.LATIDO_TOKEN;
    const espia = githubResponde(runsHace(null));

    const { GET } = await import("../app/api/latido/route");
    const respuesta = await GET(pedir());

    expect(respuesta.status).toBe(503);
    expect(await respuesta.json()).toMatchObject({ ok: false });
    expect(espia).not.toHaveBeenCalled();
  });

  it("con la clave equivocada no llama a GitHub", async () => {
    const espia = githubResponde(runsHace(null));

    const { GET } = await import("../app/api/latido/route");
    const respuesta = await GET(pedir("otra-cosa"));

    expect(respuesta.status).toBe(401);
    expect(espia).not.toHaveBeenCalled();
  });

  it("con la clave correcta pide a GitHub que ejecute el workflow", async () => {
    const espia = githubResponde(runsHace(45), new Response(null, { status: 204 }));

    const { GET } = await import("../app/api/latido/route");
    const respuesta = await GET(pedir("clave-larga-de-verdad"));

    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({ ok: true, disparado: true });

    const [url, init] = espia.mock.calls[1] ?? [];
    expect(String(url)).toContain("/actions/workflows/watch.yml/dispatches");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ ref: "main" });
  });

  it("acepta la clave por cabecera, que no acaba en los logs como la URL", async () => {
    const espia = githubResponde(runsHace(45), new Response(null, { status: 204 }));

    const { GET } = await import("../app/api/latido/route");
    const respuesta = await GET(
      new NextRequest("https://panel.vercel.app/api/latido", {
        headers: { "x-latido-token": "clave-larga-de-verdad" },
      }),
    );

    expect(respuesta.status).toBe(200);
    expect(espia.mock.calls.length).toBe(2);
  });

  it("si acaba de ejecutarse, no dispara otra vez", async () => {
    // Sin esto, quien se haga con la URL puede lanzar ejecuciones en bucle.
    const espia = githubResponde(runsHace(3));

    const { GET } = await import("../app/api/latido/route");
    const respuesta = await GET(pedir("clave-larga-de-verdad"));

    // 200 y no 429: para el servicio de cron esto es un éxito, que es lo que es.
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toMatchObject({ ok: true, disparado: false });
    expect(espia.mock.calls.length).toBe(1);
  });

  it("si nunca se ejecutó, dispara", async () => {
    githubResponde(runsHace(null), new Response(null, { status: 204 }));

    const { GET } = await import("../app/api/latido/route");
    expect(await (await GET(pedir("clave-larga-de-verdad"))).json()).toMatchObject({
      disparado: true,
    });
  });

  it("un 403 de GitHub señala el permiso de Actions, no un misterio", async () => {
    githubResponde(runsHace(45), new Response("Resource not accessible", { status: 403 }));

    const { GET } = await import("../app/api/latido/route");
    const respuesta = await GET(pedir("clave-larga-de-verdad"));

    expect(respuesta.status).toBe(502);
    expect((await respuesta.json()).mensaje).toMatch(/permiso de Actions/);
  });
});
