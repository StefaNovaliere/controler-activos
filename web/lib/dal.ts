import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { readSession } from "./session";

/**
 * El control de acceso real.
 *
 * `proxy.ts` NO cuenta como control de acceso: CVE-2025-29927 demostró que la
 * autenticación basada solo en middleware se evita falsificando la cabecera
 * `x-middleware-subrequest`. El proxy es comodidad de navegación; la puerta está
 * aquí, y toda Server Action y todo lector de datos empieza llamándola.
 */
export const requireSession = cache(async () => {
  const session = await readSession();
  if (!session) redirect("/login");
  return session;
});
