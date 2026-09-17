import "server-only";
import { storedStatus, verifyPassword } from "./password.mjs";

/** Variables sin las cuales el panel no puede funcionar. Solo los NOMBRES se
 *  muestran nunca en pantalla; los valores no salen de aquí. */
export const REQUIRED_ENV = [
  "SESSION_SECRET",
  "PANEL_PASSWORD_HASH",
  "GITHUB_TOKEN",
  "GITHUB_REPO",
  "GITHUB_BRANCH",
  "INTERNAL_API_TOKEN",
] as const;

export function missingEnv(): string[] {
  return REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
}

/**
 * Si la contraseña se puede llegar a comprobar.
 *
 * Existe porque durante el despliegue "me he equivocado de contraseña" y "el
 * servidor no tiene el hash" daban el mismo mensaje, y no había forma de saber
 * cuál era. Decir que falta configuración no da ventaja a nadie: si falta, no
 * hay contraseña que funcione.
 */
export function passwordStatus(): "ok" | "missing" | "malformed" {
  return storedStatus(process.env.PANEL_PASSWORD_HASH);
}

export async function checkPassword(candidate: string): Promise<boolean> {
  return verifyPassword(candidate, process.env.PANEL_PASSWORD_HASH);
}
