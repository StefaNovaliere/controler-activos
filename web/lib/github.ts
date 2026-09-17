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

export const WORKFLOW_FILE = "watch.yml";

/** Cuándo se creó la ejecución más reciente del centinela, sea cual sea su
 *  estado. `null` si no hay ninguna o si no se pudo preguntar. */
export async function ultimaEjecucion(): Promise<Date | null> {
  const url =
    `${API}/repos/${env("GITHUB_REPO")}/actions/workflows/${WORKFLOW_FILE}/runs` +
    `?per_page=1`;
  const response = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!response.ok) return null;

  const json = await response.json();
  const creada = json?.workflow_runs?.[0]?.created_at;
  if (typeof creada !== "string") return null;

  const fecha = new Date(creada);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

export type Disparo = { ok: true } | { ok: false; motivo: string };

/**
 * Pide a GitHub que ejecute el centinela ahora.
 *
 * Existe porque el `schedule` de GitHub Actions no es fiable: medido en este
 * repositorio, 1 de cada 11 ejecuciones programadas llegó a dispararse. El cron
 * sigue puesto; esto es la red de seguridad, no el sustituto.
 */
export async function dispararWorkflow(): Promise<Disparo> {
  const url =
    `${API}/repos/${env("GITHUB_REPO")}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    cache: "no-store",
    body: JSON.stringify({ ref: env("GITHUB_BRANCH") }),
  });

  if (response.status === 204) return { ok: true };

  const cuerpo = (await response.text().catch(() => "")).slice(0, 300);

  // Los dos fallos que tiene sentido esperar aquí piden acciones distintas, y
  // el cuerpo de GitHub por sí solo no lo dice: un 403 por permisos y un 404
  // por workflow inexistente llegan ambos con "Not Found" o "Resource not
  // accessible", que no le sirven a nadie a las tres de la mañana.
  if (response.status === 403 || response.status === 404) {
    return {
      ok: false,
      motivo:
        `GitHub respondió ${response.status}. Casi siempre es que a GITHUB_TOKEN le falta ` +
        `el permiso de Actions (lectura y escritura). Si el token es "fine-grained", ` +
        `añádeselo en GitHub → Settings → Developer settings → Tokens y vuelve a ` +
        `desplegar. Respuesta: ${cuerpo}`,
    };
  }

  return { ok: false, motivo: `GitHub respondió ${response.status}: ${cuerpo}` };
}
