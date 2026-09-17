import "server-only";

const API = "https://api.github.com";

export const CONFIG_PATH = "config/assets.yml";
export const STATE_PATH = "state/state.json";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`falta la variable de entorno ${name}`);
  return value;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "vigilante-panel",
    ...extra,
  };
}

export type Blob = { sha: string; text: string };

/** Lee un fichero con su sha. `null` si no existe: un 404 aquí es legítimo. */
export async function readBlob(path: string): Promise<Blob | null> {
  const url = `${API}/repos/${env("GITHUB_REPO")}/contents/${path}?ref=${encodeURIComponent(env("GITHUB_BRANCH"))}`;
  const response = await fetch(url, { headers: headers(), cache: "no-store" });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} al leer ${path}: ${await response.text()}`);
  }

  const json = await response.json();
  if (json.content === undefined) {
    // Por encima de 1 MB la Contents API omite el contenido y devolvería "".
    throw new Error(`${path} supera 1 MB: haría falta la API de blobs`);
  }
  return { sha: json.sha, text: Buffer.from(json.content, "base64").toString("utf8") };
}

/** Lee un fichero en crudo, sin sha y sin base64. Cacheable. */
export async function readRaw(path: string, revalidateSeconds: number, tag: string) {
  const url = `${API}/repos/${env("GITHUB_REPO")}/contents/${path}?ref=${encodeURIComponent(env("GITHUB_BRANCH"))}`;
  const response = await fetch(url, {
    headers: headers({ Accept: "application/vnd.github.raw" }),
    next: { revalidate: revalidateSeconds, tags: [tag] },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${response.status} al leer ${path}`);
  return response.text();
}

type PutResult =
  | { kind: "ok"; commitSha: string; htmlUrl: string }
  | { kind: "conflict" };

async function putBlob(
  path: string,
  content: string,
  sha: string | undefined,
  message: string,
): Promise<PutResult> {
  const response = await fetch(`${API}/repos/${env("GITHUB_REPO")}/contents/${path}`, {
    method: "PUT",
    headers: headers({ "Content-Type": "application/json" }),
    cache: "no-store",
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha, // undefined = creación
      branch: env("GITHUB_BRANCH"),
      // Sin `committer`: GitHub atribuye el commit al dueño del token, que es
      // quien de verdad está haciendo el cambio. Poner uno inventado fue un
      // error con consecuencias: `nombre@users.noreply.github.com` es un formato
      // RESERVADO de GitHub y resuelve al usuario real con ese nombre, así que
      // los commits acababan atribuidos a un desconocido llamado "panel".
      // Que vienen del panel ya lo dice el mensaje: "config(panel): …".
    }),
  });

  if (response.status === 409 || response.status === 422) return { kind: "conflict" };
  if (!response.ok) {
    throw new Error(`GitHub ${response.status} al escribir ${path}: ${await response.text()}`);
  }
  const json = await response.json();
  return { kind: "ok", commitSha: json.commit.sha, htmlUrl: json.commit.html_url };
}

export type SaveOutcome =
  | { ok: true; commitSha: string; htmlUrl: string }
  | { ok: false; reason: "stale"; currentText: string; currentSha: string }
  | { ok: false; reason: "busy" };

/**
 * Guarda la configuración distinguiendo los DOS conflictos que comparten código
 * HTTP, porque confundirlos es como se pierde el trabajo de alguien:
 *
 *  1. El blob cambió de verdad — otra pestaña u otra persona editó. Reintentar
 *     aquí PISARÍA su cambio, así que se devuelve y decide el humano.
 *  2. El blob es el mismo pero la rama se movió — el bot acaba de commitear
 *     `state/`. Es una carrera de milisegundos: se reintenta.
 *
 * La distinción se hace releyendo el sha, no parseando el mensaje de error, que
 * es frágil.
 */
export async function saveConfig(
  newText: string,
  expectedSha: string,
  message: string,
): Promise<SaveOutcome> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await putBlob(CONFIG_PATH, newText, expectedSha, message);
    if (result.kind === "ok") {
      return { ok: true, commitSha: result.commitSha, htmlUrl: result.htmlUrl };
    }

    const current = await readBlob(CONFIG_PATH);
    if (current && current.sha !== expectedSha) {
      return { ok: false, reason: "stale", currentText: current.text, currentSha: current.sha };
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * attempt + Math.random() * 400));
  }
  return { ok: false, reason: "busy" };
}

/** Cuándo caduca el token, para avisar antes de que el panel deje de guardar. */
export async function tokenExpiry(): Promise<string | null> {
  try {
    const response = await fetch(`${API}/`, { headers: headers(), cache: "no-store" });
    return response.headers.get("github-authentication-token-expiration");
  } catch {
    return null;
  }
}
