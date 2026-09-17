import "server-only";

/** Las funciones Python viven en el mismo despliegue que el Next. */
function baseUrl(): string {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.PANEL_BASE_URL ?? "http://127.0.0.1:3000";
}

export async function callPython<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Estas funciones no las llama nunca el navegador, solo el servidor.
      "x-panel-token": process.env.INTERNAL_API_TOKEN ?? "",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${path} respondió ${response.status}`);
  }
  return (await response.json()) as T;
}
