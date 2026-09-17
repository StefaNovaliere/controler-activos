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
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
