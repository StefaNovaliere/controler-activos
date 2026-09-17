// Genera la clave del despertador. Aparte de gen-secrets.mjs a propósito: quien
// ya tiene el panel funcionando no debe volver a ejecutar aquel, que imprimiría
// una contraseña nueva y un hash nuevo, y le tocaría cambiar el login sin
// ninguna necesidad.
//
//   node scripts/gen-latido.mjs
import { randomBytes } from "node:crypto";

const clave = randomBytes(32).toString("base64url");

console.log(`
PASO 1 · Pega esta línea en Vercel → Settings → Environment Variables
         (marcada para Production) y vuelve a desplegar.

LATIDO_TOKEN=${clave}

PASO 2 · Crea una tarea en https://cron-job.org (gratis, con tu email):

         URL       https://TU-PANEL.vercel.app/api/latido
         Intervalo cada 30 minutos
         Cabecera  x-latido-token: ${clave}

         Si el servicio no deja poner cabeceras, vale también:
         https://TU-PANEL.vercel.app/api/latido?clave=${clave}
         (peor: las URLs quedan en los registros del servicio).

Esta clave solo sirve para pedir una comprobación de precios. No da acceso al
panel ni a tu repositorio: el token de GitHub no sale de Vercel.
`);
