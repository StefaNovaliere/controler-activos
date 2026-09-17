import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const COOKIE = "vigilante_session";
const TTL_SECONDS = 60 * 60 * 12; // una jornada de trabajo, no un mes

function key(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error("SESSION_SECRET ausente o de menos de 32 caracteres");
  }
  return new TextEncoder().encode(raw);
}

export async function createSession(): Promise<void> {
  const token = await new SignJWT({ sub: "panel" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("vigilante-panel")
    .setAudience("vigilante-panel")
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(key());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true, // el JavaScript del navegador no la ve
    secure: process.env.NODE_ENV === "production",
    // "lax" y no "strict": con strict, entrar desde un enlace de Telegram o un
    // marcador no envía la cookie y manda al login teniendo sesión válida. La
    // protección CSRF ya la dan las Server Actions validando Origin contra Host.
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
}

export async function verifyToken(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: "vigilante-panel",
      audience: "vigilante-panel",
      algorithms: ["HS256"], // fijar el algoritmo cierra el ataque de alg:none
    });
    return payload;
  } catch {
    return null; // firma inválida, caducada, o SESSION_SECRET rotado
  }
}

export async function readSession() {
  const jar = await cookies();
  return verifyToken(jar.get(COOKIE)?.value);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
