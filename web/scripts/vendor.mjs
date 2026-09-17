// Copia dentro de web/ lo que vive en la raíz del repositorio.
//
// Dos cosas, por dos motivos distintos:
//
//   src/vigilante -> api/_vendor/vigilante
//     Vercel puede incluir ficheros de fuera del Root Directory si marcas
//     "Include source files outside of the Root Directory in the Build Step",
//     pero si esa casilla se queda sin marcar el fallo aparece en RUNTIME como un
//     ImportError en /api/validate, no en el build. Esta copia es la red de
//     seguridad: si existe, las funciones Python la prefieren.
//
//   schema/*.json -> generated/
//     El bundle del cliente no puede importar nada de fuera de la raíz del
//     proyecto Next. Como el esquema y la lista de proveedores se generan desde
//     pydantic, copiarlos aquí mantiene una única fuente de verdad.
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const root = join(web, "..");

async function copiar(desde, hasta, etiqueta) {
  if (!existsSync(desde)) {
    console.warn(`[vendor] no encuentro ${desde}; se omite ${etiqueta}`);
    return;
  }
  await rm(hasta, { recursive: true, force: true });
  await mkdir(dirname(hasta), { recursive: true });
  await cp(desde, hasta, { recursive: true });
  console.log(`[vendor] ${etiqueta}: ${desde} -> ${hasta}`);
}

await copiar(join(root, "src", "vigilante"), join(web, "api", "_vendor", "vigilante"), "python");

await mkdir(join(web, "generated"), { recursive: true });
for (const file of ["config.schema.json", "providers.json"]) {
  await copiar(join(root, "schema", file), join(web, "generated", file), `esquema ${file}`);
}
