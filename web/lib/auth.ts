import "server-only";
import { scrypt as scryptCallback, timingSafeEqual, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options?: object,
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 32;

/**
 * Comprueba la contraseña del panel.
 *
 * `scrypt` con N=16384 cuesta ~100 ms por intento. Ese coste ES el freno de
 * fuerza bruta: no depende de ningún servicio externo ni de guardar estado entre
 * peticiones, que en una función serverless no existe.
 */
export async function checkPassword(candidate: string): Promise<boolean> {
  const stored = process.env.PANEL_PASSWORD_HASH ?? "";
  const [scheme, saltB64, hashB64] = stored.split(":");
  const configured = scheme === "scrypt" && Boolean(saltB64) && Boolean(hashB64);

  // Si el despliegue está mal configurado hacemos el MISMO trabajo con valores
  // falsos: el tiempo de respuesta no debe permitir distinguir "sin configurar"
  // de "contraseña incorrecta".
  const salt = configured ? Buffer.from(saltB64, "base64") : randomBytes(16);
  const expected = configured ? Buffer.from(hashB64, "base64") : randomBytes(KEYLEN);

  const got = await scrypt(candidate.normalize("NFKC"), salt, KEYLEN, PARAMS);
  const same = expected.length === got.length && timingSafeEqual(expected, got);
  return configured && same;
}
