#!/usr/bin/env node
/**
 * Genera los secretos del panel.
 *
 *   node scripts/gen-secrets.mjs          genera también la contraseña
 *   node scripts/gen-secrets.mjs --ask    la pides tú, tecleada sin eco
 *
 * Sin argumentos y sin comillas: funciona igual en PowerShell, cmd, bash y zsh.
 * La versión anterior de esto eran dos `node -e '...'` con comillas anidadas, que
 * en PowerShell fallan porque elimina las comillas dobles internas al invocar un
 * ejecutable nativo.
 *
 * Y sobre todo: la contraseña NUNCA se pasa como argumento. Un argumento acaba en
 * el historial del shell (PSReadLine lo guarda aunque el comando falle) y en Unix
 * es visible en `ps` mientras el proceso corre.
 */
import { randomBytes, randomInt } from "node:crypto";
import readline from "node:readline";
import { hashPassword } from "../lib/password.mjs";

// Sin 0/O/1/I/l: la contraseña hay que poder dictarla por teléfono sin dudas.
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const GRUPOS = 4;
const POR_GRUPO = 4;

function generarContrasena() {
  const grupos = [];
  for (let g = 0; g < GRUPOS; g++) {
    let grupo = "";
    for (let c = 0; c < POR_GRUPO; c++) grupo += ALFABETO[randomInt(ALFABETO.length)];
    grupos.push(grupo);
  }
  return grupos.join("-");
}

function preguntarSinEco(pregunta) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let mudo = false;
    rl._writeToOutput = (texto) => {
      if (!mudo) rl.output.write(texto);
    };
    rl.question(pregunta, (respuesta) => {
      rl.close();
      process.stdout.write("\n");
      resolve(respuesta);
    });
    mudo = true;
  });
}

const aleatorio = (bytes) => randomBytes(bytes).toString("base64url");

const pedir = process.argv.includes("--ask");
let contrasena;

if (pedir) {
  contrasena = await preguntarSinEco("Contraseña del panel (no se verá al teclear): ");
  if (!contrasena.trim()) {
    console.error("\nNo has escrito nada. Cancelado.");
    process.exit(1);
  }
  if (contrasena.length < 12) {
    console.error(
      "\nEsa contraseña tiene menos de 12 caracteres. El panel es la única puerta\n" +
        "al token de escritura de tu repositorio: vuelve a ejecutarlo sin --ask y\n" +
        "usa la que genera el script.",
    );
    process.exit(1);
  }
} else {
  contrasena = generarContrasena();
}

const hash = await hashPassword(contrasena);

console.log(`
╭─ Variables de entorno para Vercel ────────────────────────────────
│  Settings → Environment Variables. Pégalas tal cual.
╰───────────────────────────────────────────────────────────────────

SESSION_SECRET=${aleatorio(48)}
INTERNAL_API_TOKEN=${aleatorio(32)}
PANEL_PASSWORD_HASH=${hash}
`);

if (!pedir) {
  console.log(`╭─ La contraseña del panel ─────────────────────────────────────────
│  Esto es lo ÚNICO que tienes que guardar aparte y darle a quien
│  vaya a entrar. No se puede recuperar del hash de arriba.
╰───────────────────────────────────────────────────────────────────

    ${contrasena}
`);
}

console.log(`Faltan por tu parte GITHUB_TOKEN, GITHUB_REPO y GITHUB_BRANCH: ver README.
Si te equivocas o quieres cambiarla, vuelve a ejecutar esto y actualiza las
variables en Vercel. Rotar SESSION_SECRET cierra la sesión en todos los
dispositivos a la vez.`);
