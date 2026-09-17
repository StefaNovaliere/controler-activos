import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { verifyPassword } from "../lib/password.mjs";

const SCRIPT = join(__dirname, "..", "scripts", "gen-secrets.mjs");

/** Se ejecuta desde la raíz del repositorio a propósito: es lo que hace el README,
 *  y comprueba que el script no depende del directorio desde el que se lanza. */
function ejecutar(): string {
  return execFileSync(process.execPath, [SCRIPT], {
    cwd: join(__dirname, "..", ".."),
    encoding: "utf8",
  });
}

function extraer(salida: string, clave: string): string {
  const match = salida.match(new RegExp(`^${clave}=(.+)$`, "m"));
  if (!match) throw new Error(`no encontré ${clave} en la salida`);
  return match[1].trim();
}

describe("generador de secretos", () => {
  it("la contraseña que imprime valida contra el hash que imprime", async () => {
    // El circuito completo, por la CLI real: si el script se rompe o cambia de
    // formato, esto se entera. Es la garantía de que quien siga el README acabará
    // con unas credenciales que el panel acepta.
    const salida = ejecutar();
    const hash = extraer(salida, "PANEL_PASSWORD_HASH");

    // Sin atarse a la indentación: el formato de la salida puede cambiar, lo que
    // no puede cambiar es que la contraseña esté sola en su línea.
    const contrasena = salida.match(/^\s*([2-9A-Z]{4}(?:-[2-9A-Z]{4}){3})\s*$/m)?.[1];
    expect(contrasena, "el script debe imprimir la contraseña en grupos de cuatro").toBeTruthy();

    await expect(verifyPassword(contrasena!, hash)).resolves.toBe(true);
    await expect(verifyPassword("OTRA-CLAV-EDIS-TINT", hash)).resolves.toBe(false);
  });

  it("imprime las tres variables de entorno que pide el README", () => {
    const salida = ejecutar();
    for (const clave of ["SESSION_SECRET", "INTERNAL_API_TOKEN", "PANEL_PASSWORD_HASH"]) {
      expect(extraer(salida, clave).length).toBeGreaterThan(20);
    }
  });

  it("la contraseña se lee antes que el hash, que es lo que confunde", () => {
    // Cuando iba al final, detrás de una variable llamada PANEL_PASSWORD_HASH,
    // un usuario real leyó la salida entera y preguntó cuál era la contraseña.
    const salida = ejecutar();
    const posClave = salida.search(/^\s*[2-9A-Z]{4}(?:-[2-9A-Z]{4}){3}\s*$/m);
    expect(posClave).toBeGreaterThanOrEqual(0);
    expect(posClave).toBeLessThan(salida.indexOf("PANEL_PASSWORD_HASH="));
  });

  it("cada ejecución da secretos distintos", () => {
    expect(extraer(ejecutar(), "SESSION_SECRET")).not.toBe(extraer(ejecutar(), "SESSION_SECRET"));
  });

  it("no arrastra dependencias externas", () => {
    // Por eso el README puede decir que no hace falta `npm install`. Si alguien
    // añade un import de node_modules, esto lo delata.
    const fuentes = [SCRIPT, join(__dirname, "..", "lib", "password.mjs")];
    for (const fuente of fuentes) {
      const texto = execFileSync("cat", [fuente], { encoding: "utf8" });
      const imports = [...texto.matchAll(/^import .* from "([^"]+)"/gm)].map((m) => m[1]);
      for (const especificador of imports) {
        expect(
          especificador.startsWith("node:") || especificador.startsWith("."),
          `${fuente} importa "${especificador}", que no es interno ni relativo`,
        ).toBe(true);
      }
    }
  });
});
