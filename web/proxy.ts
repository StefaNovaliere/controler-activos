import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, COOKIE } from "@/lib/session";

// En Next 16 este fichero se llama proxy.ts y la función proxy(). Si se llamara
// middleware.ts, no se cargaría y la redirección al login quedaría inactiva SIN
// ningún error. Compruébalo en ventana de incógnito tras el primer despliegue.
export async function proxy(request: NextRequest) {
  const session = await verifyToken(request.cookies.get(COOKIE)?.value);
  if (session) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // `api` está excluido a propósito. Las funciones Python de /api/ las llama el
  // SERVIDOR (lib/internal.ts), no el navegador, así que no llevan cookie de
  // sesión: con /api/ dentro del matcher, este proxy las redirigía a /login,
  // `fetch` seguía la redirección en silencio y el panel recibía 200 con el HTML
  // del login en vez de JSON. Desde el navegador funcionaba —lleva cookie—, que
  // es lo que hacía el fallo difícil de ver.
  //
  // Excluirlas no las deja abiertas: cada función comprueba `x-panel-token`
  // contra INTERNAL_API_TOKEN con hmac.compare_digest y responde 401 sin él.
  // Esa es su autenticación, no la cookie.
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
