import "server-only";
import { verifyPassword } from "./password.mjs";

/**
 * Comprueba la contraseña del panel contra `PANEL_PASSWORD_HASH`.
 *
 * El trabajo criptográfico vive en `password.mjs` para que el generador de
 * secretos use exactamente los mismos parámetros. Aquí solo queda la lectura del
 * entorno.
 */
export async function checkPassword(candidate: string): Promise<boolean> {
  return verifyPassword(candidate, process.env.PANEL_PASSWORD_HASH);
}
