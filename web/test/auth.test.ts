import { describe, expect, it, beforeAll } from "vitest";
import { checkPassword } from "../lib/auth";
import { hashPassword, verifyPassword } from "../lib/password.mjs";

const PASSWORD = "caballo-batería-grapa-correcto";

describe("contraseña del panel", () => {
  beforeAll(async () => {
    process.env.PANEL_PASSWORD_HASH = await hashPassword(PASSWORD);
  });

  it("el hash que genera el script es el que acepta el panel", async () => {
    // Cierra el círculo: antes el README generaba el hash por un lado y el panel
    // lo verificaba por otro, sin que nada comprobara que los parámetros de
    // scrypt coincidían.
    const hash = await hashPassword("otra-contraseña-distinta");
    await expect(verifyPassword("otra-contraseña-distinta", hash)).resolves.toBe(true);
    await expect(verifyPassword("casi-la-misma", hash)).resolves.toBe(false);
  });

  it("dos hashes de la misma contraseña son distintos", async () => {
    // Sal aleatoria: si salieran iguales, dos paneles con la misma contraseña
    // serían distinguibles mirando la variable de entorno.
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
    await expect(verifyPassword(PASSWORD, a)).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, b)).resolves.toBe(true);
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
    await expect(verifyPassword("basura", "basura")).resolves.toBe(false);
    await expect(verifyPassword("x", "scrypt:solo-dos-partes")).resolves.toBe(false);
  });
});
