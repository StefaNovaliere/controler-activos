import { describe, expect, it, beforeAll } from "vitest";
import { scryptSync, randomBytes } from "node:crypto";
import { checkPassword } from "../lib/auth";

const PASSWORD = "caballo-batería-grapa-correcto";

function hash(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString("base64")}:${derived.toString("base64")}`;
}

describe("contraseña del panel", () => {
  beforeAll(() => {
    process.env.PANEL_PASSWORD_HASH = hash(PASSWORD);
  });

  it("acepta la correcta", async () => {
    await expect(checkPassword(PASSWORD)).resolves.toBe(true);
  });

  it("rechaza la incorrecta", async () => {
    await expect(checkPassword("otra-cosa")).resolves.toBe(false);
  });

  it("rechaza la cadena vacía", async () => {
    await expect(checkPassword("")).resolves.toBe(false);
  });

  it("normaliza los acentos para que no dependan del teclado", async () => {
    // "batería" tecleada como e + tilde combinante en vez de é.
    const descompuesta = PASSWORD.normalize("NFD");
    expect(descompuesta).not.toBe(PASSWORD);
    await expect(checkPassword(descompuesta)).resolves.toBe(true);
  });

  it("sin configurar, rechaza cualquier cosa", async () => {
    const previo = process.env.PANEL_PASSWORD_HASH;
    delete process.env.PANEL_PASSWORD_HASH;
    await expect(checkPassword("")).resolves.toBe(false);
    await expect(checkPassword("lo-que-sea")).resolves.toBe(false);
    process.env.PANEL_PASSWORD_HASH = previo;
  });

  it("un hash con formato roto no deja entrar a nadie", async () => {
    const previo = process.env.PANEL_PASSWORD_HASH;
    process.env.PANEL_PASSWORD_HASH = "basura";
    await expect(checkPassword("basura")).resolves.toBe(false);
    process.env.PANEL_PASSWORD_HASH = previo;
  });
});
