import "server-only";

/** La petición no llegó a la función Python, o no contestó algo que podamos
 *  entender. Es distinto de "la función contestó que la configuración es
 *  inválida": eso es un veredicto, esto es una avería. */
export class PythonInalcanzable extends Error {}

/**
 * Llamada del panel a sus propias funciones Python.
 *
 * Vercel no tiene bucle interno: la petición sale al edge y vuelve a entrar. Eso
 * tiene dos trampas que dan el mismo 401 y que hay que separar para poder
 * arreglarlas:
 *
 *  1. `VERCEL_URL` es la URL del DESPLIEGUE concreto, no la de producción. La
 *     Protección de Despliegue cubre esas URLs aunque el dominio de producción
 *     esté abierto, así que la app se queda fuera de sí misma.
 *  2. `INTERNAL_API_TOKEN` distinto entre el runtime de Next y la función Python.
 */
function baseUrl(): string {
  // Preferir el dominio de producción: es el que no está protegido.
  const produccion = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_ENV === "production" && produccion) return `https://${produccion}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return process.env.PANEL_BASE_URL ?? "http://127.0.0.1:3000";
}

function headers(): Record<string, string> {
  const salida: Record<string, string> = {
    "content-type": "application/json",
    // Estas funciones no las llama nunca el navegador, solo el servidor.
    "x-panel-token": process.env.INTERNAL_API_TOKEN ?? "",
  };
  // Si hay un Protection Bypass configurado, atraviesa la protección de Vercel
  // sin desactivarla. Es el mecanismo que la propia Vercel documenta para esto.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) salida["x-vercel-protection-bypass"] = bypass;
  return salida;
}

export async function callPython<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    throw new PythonInalcanzable(
      `No se pudo contactar con ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) throw new PythonInalcanzable(await explicar(path, response));

  // Un 200 con HTML es lo que devuelven la pantalla de protección de Vercel y
  // el 404 de Next. Parsearlo como JSON produce un "Unexpected token '<'" que no
  // dice nada: mejor mirar el tipo de contenido y explicar qué está pasando.
  const tipo = response.headers.get("content-type") ?? "";
  if (!tipo.includes("json")) {
    const cuerpo = (await response.text().catch(() => "")).trim();
    throw new PythonInalcanzable(
      `${path} respondió ${response.status} con ${tipo || "tipo desconocido"} en vez de JSON. ` +
        (cuerpo.startsWith("<")
          ? `Es una página HTML, así que la petición no llegó a la función Python: o la ` +
            `Protección de Despliegue de Vercel la está interceptando, o la función no está ` +
            `desplegada. Ábrela en el navegador para comprobarlo: debe contestar "Unsupported ` +
            `method" y no una página web.`
          : `Empieza por: ${cuerpo.slice(0, 120)}`),
    );
  }

  return (await response.json()) as T;
}

/** Un 401 puede venir de dos sitios muy distintos; decir cuál ahorra la tarde. */
async function explicar(path: string, response: Response): Promise<string> {
  const cuerpo = await response.text().catch(() => "");

  if (response.status === 401) {
    if (cuerpo.includes("no autorizado")) {
      return (
        `${path} rechazó la llamada: INTERNAL_API_TOKEN no coincide entre el panel y la ` +
        `función de validación. Revísalo en Vercel → Settings → Environment Variables ` +
        `(que esté marcado Production) y vuelve a desplegar.`
      );
    }
    return (
      `La Protección de Despliegue de Vercel está bloqueando la llamada interna a ${path}. ` +
      `En Vercel → Settings → Deployment Protection: deja Production sin proteger, o crea ` +
      `un "Protection Bypass for Automation" (se expone solo como ` +
      `VERCEL_AUTOMATION_BYPASS_SECRET y el panel lo usa sin más).`
    );
  }

  if (response.status === 404) {
    return (
      `${path} no existe en el despliegue. Comprueba que en Vercel está marcado ` +
      `"Include source files outside of the Root Directory in the Build Step".`
    );
  }

  return `${path} respondió ${response.status}: ${cuerpo.slice(0, 200)}`;
}
