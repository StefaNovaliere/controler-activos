/**
 * Hash y verificación de la contraseña del panel.
 *
 * Vive en un `.mjs` sin `server-only` a propósito: lo importan tanto el panel
 * (`lib/auth.ts`) como el generador de secretos (`scripts/gen-secrets.mjs`), que
 * es node pelado. Así los parámetros de scrypt existen UNA vez. Cuando estaban
 * duplicados entre el código y un comando del README, cambiar uno producía hashes
 * que el otro no verificaba.
 */
import { scrypt as scryptCallback, timingSafeEqual, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

/** ~100 ms por intento. Ese coste ES el freno de fuerza bruta: no necesita
 *  estado entre peticiones, que en una función serverless no existe. */
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
export const KEYLEN = 32;
export const SCHEME = "scrypt";

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(normalize(password), salt, KEYLEN, SCRYPT_PARAMS);
  return `${SCHEME}:${salt.toString("base64")}:${derived.toString("base64")}`;
}

/**
 * Limpia un valor pegado a mano en el panel de Vercel.
 *
 * El generador imprime líneas con forma `CLAVE=valor` y hay que separarlas en dos
 * casillas. Pegar la línea entera en la casilla del valor es el error natural, y
 * sin esto produce exactamente el mismo "contraseña incorrecta" que teclearla
 * mal: indistinguible y sin pista. Lo mismo con los espacios de un copiar/pegar
 * o las comillas que algunos editores añaden.
 */
export function normalizeStored(stored) {
  let value = String(stored ?? "").trim();
  value = value.replace(/^[A-Z_][A-Z0-9_]*\s*=\s*/, "");
  value = value.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  return value;
}

/** Por qué no se puede verificar, para poder decirlo en vez de callarlo. */
export function storedStatus(stored) {
  const value = normalizeStored(stored);
  if (!value) return "missing";
  const [scheme, saltB64, hashB64] = value.split(":");
  if (scheme !== SCHEME || !saltB64 || !hashB64) return "malformed";
  return "ok";
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = normalizeStored(stored).split(":");
  const configured = scheme === SCHEME && Boolean(saltB64) && Boolean(hashB64);

  // Si el despliegue está mal configurado hacemos el MISMO trabajo con valores
  // falsos: el tiempo de respuesta no debe permitir distinguir "sin configurar"
  // de "contraseña incorrecta".
  const salt = configured ? Buffer.from(saltB64, "base64") : randomBytes(16);
  const expected = configured ? Buffer.from(hashB64, "base64") : randomBytes(KEYLEN);

  const got = await scrypt(normalize(password), salt, KEYLEN, SCRYPT_PARAMS);
  const same = expected.length === got.length && timingSafeEqual(expected, got);
  return configured && same;
}

/** Sin esto, una contraseña con acentos falla o no según cómo la teclees. */
function normalize(password) {
  return String(password ?? "").normalize("NFKC");
}
