import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispararWorkflow, ultimaEjecucion } from "@/lib/github";

/**
 * El despertador del centinela.
 *
 * El `schedule` de GitHub Actions no es fiable: medido en este repositorio, de
 * 11 ejecuciones programadas se disparó 1, y esa con 9 minutos de retraso. Y un
 * cruce que ocurre y se deshace entre dos ejecuciones no llega tarde: no se
 * detecta nunca. Así que un servicio externo gratuito llama a esta ruta cada 30
 * minutos y ella le pide a GitHub que ejecute el centinela.
 *
 * El servicio externo NO recibe el token de GitHub. Solo conoce esta URL y una
 * clave que sirve para una única cosa: pedir una comprobación de precios. El
 * token sigue donde estaba, en las variables de entorno de Vercel.
 *
 * El cron de GitHub se deja puesto. Esto es la red, no el sustituto.
 */

// Sin esto Next la prerenderiza y el despertador devolvería una respuesta
// congelada en el momento del build en vez de disparar nada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Aunque alguien se haga con la URL, no puede lanzar ejecuciones en bucle.
 *  Por debajo del intervalo del cron (15 min) para no descartar el latido
 *  legítimo por unos segundos de desfase del servicio externo. */
const MINIMOS_ENTRE_DISPAROS = 7;

function iguales(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual lanza si las longitudes difieren, así que hay que mirarlas
  // antes; la longitud de un token no es el secreto.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

type Veredicto = { ok: true } | { ok: false; estado: number; mensaje: string };

function autorizar(request: NextRequest): Veredicto {
  const esperado = process.env.LATIDO_TOKEN?.trim();
  if (!esperado) {
    // Sin clave configurada NO se abre: una ruta que dispara workflows sin
    // autenticar es una invitación. Mejor que el despertador falle ruidosamente.
    return {
      ok: false,
      estado: 503,
      mensaje:
        "Falta la variable de entorno LATIDO_TOKEN en Vercel. Sin ella esta ruta no " +
        "dispara nada, porque quedaría abierta a cualquiera.",
    };
  }

  // Cabecera si el servicio la admite; query si no. La cabecera es mejor: las
  // URLs acaban en logs y en historiales, las cabeceras mucho menos.
  const recibido =
    request.headers.get("x-latido-token") ?? request.nextUrl.searchParams.get("clave") ?? "";

  if (!iguales(recibido, esperado)) {
    return { ok: false, estado: 401, mensaje: "Clave incorrecta o ausente." };
  }
  return { ok: true };
}

async function latido(request: NextRequest) {
  const permiso = autorizar(request);
  if (!permiso.ok) {
    return NextResponse.json({ ok: false, mensaje: permiso.mensaje }, { status: permiso.estado });
  }

  try {
    const ultima = await ultimaEjecucion();
    const minutos = ultima === null ? null : (Date.now() - ultima.getTime()) / 60_000;

    if (minutos !== null && minutos < MINIMOS_ENTRE_DISPAROS) {
      // 200, no 429: para el servicio externo esto es un éxito. Que ya se haya
      // ejecutado hace un momento es justo lo que queríamos conseguir.
      return NextResponse.json({
        ok: true,
        disparado: false,
        motivo: `El centinela se ejecutó hace ${Math.round(minutos)} min; no hace falta otra.`,
      });
    }

    const disparo = await dispararWorkflow();
    if (!disparo.ok) {
      return NextResponse.json({ ok: false, disparado: false, mensaje: disparo.motivo }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      disparado: true,
      motivo:
        minutos === null
          ? "No consta ninguna ejecución previa."
          : `La última fue hace ${Math.round(minutos)} min.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, mensaje: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

// Los servicios de cron gratuitos mandan GET por defecto; POST es lo correcto
// para algo que tiene efecto. Se aceptan los dos: obligar al usuario a
// configurar el método es una forma tonta de que esto no funcione.
export const GET = latido;
export const POST = latido;
