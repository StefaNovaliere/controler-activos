# Panel del centinela

Para que alguien que no programa pueda cambiar qué se vigila y con qué umbrales,
sin abrir GitHub ni ver un YAML.

La configuración **sigue viviendo en el repositorio**: al guardar, el panel
commitea `config/assets.yml`. No hay base de datos. `git log config/assets.yml`
sigue siendo el historial de quién cambió qué.

## Despliegue en Vercel, paso a paso

### 1. Crea el token de GitHub

*Settings → Developer settings → Personal access tokens → **Fine-grained tokens***

| Campo | Valor |
|---|---|
| Resource owner | tu usuario |
| Repository access | **Only select repositories** → `controler-activos` |
| Repository permissions | **`Contents: Read and write`** y nada más |
| Expiration | 90 días |

`Metadata: Read-only` se marca solo, es obligatorio. **No** des `Workflows`, ni
`Actions`, ni `Secrets`, ni `Administration`: el panel solo escribe un fichero.

> Estos tokens **caducan a la fuerza**. El panel te avisa cuando quedan menos de
> 14 días; si caduca, podrá leer pero no guardar.

### 2. Genera los secretos

Necesitas los ficheros del proyecto en tu ordenador y [Node.js](https://nodejs.org)
instalado. **No hace falta `npm install`**: el generador solo usa módulos internos
de Node.

Con git:

```
git clone https://github.com/StefaNovaliere/controler-activos.git
cd controler-activos
```

Sin git: en GitHub, botón verde **Code → Download ZIP**, descomprime y abre una
terminal en esa carpeta (en Windows, shift + clic derecho dentro de ella →
*Abrir ventana de PowerShell aquí*).

Ya dentro de la carpeta del proyecto, un solo comando, sin comillas ni argumentos.
Funciona igual en PowerShell, cmd, bash y zsh:

```
node web/scripts/gen-secrets.mjs
```

En PowerShell puedes escribir las barras como `web\scripts\gen-secrets.mjs`; las
dos formas valen.

Te imprime `SESSION_SECRET`, `INTERNAL_API_TOKEN` y `PANEL_PASSWORD_HASH` listos
para pegar, y aparte **la contraseña del panel**, que es lo único que tienes que
guardar por tu cuenta y darle a quien vaya a entrar. Del hash no se puede sacar.

Si prefieres elegirla tú:

```
node web/scripts/gen-secrets.mjs --ask
```

La pide por teclado **sin eco**. En ningún caso la contraseña viaja como argumento
del comando: un argumento acaba en el historial del shell —PSReadLine lo guarda
aunque el comando falle— y en Linux o macOS queda visible en `ps` mientras el
proceso corre.

> **Deja que la genere el script.** El panel es la única puerta al token con
> permiso de escritura sobre tu repositorio. El coste de `scrypt` (~100 ms por
> intento) frena la fuerza bruta, pero no salva una contraseña adivinable.

> Si en algún intento anterior tecleaste una contraseña como argumento en
> PowerShell, está guardada en texto plano en
> `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`.
> Genera otra y, si quieres, borra esa línea del fichero.

### 3. Importa el repositorio en Vercel

| Ajuste | Valor |
|---|---|
| Framework Preset | Next.js |
| **Root Directory** | **`web`** |
| **Include source files outside of the Root Directory** | ✅ márcalo (no es imprescindible: ver abajo) |
| Node.js Version | 22.x |

Variables de entorno (*Settings → Environment Variables*):

| Variable | Valor |
|---|---|
| `SESSION_SECRET` | el primer comando de arriba |
| `PANEL_PASSWORD_HASH` | el segundo comando de arriba |
| `GITHUB_TOKEN` | el token del paso 1 |
| `GITHUB_REPO` | `StefaNovaliere/controler-activos` |
| `GITHUB_BRANCH` | la rama por defecto del repositorio |
| `INTERNAL_API_TOKEN` | otros 32 bytes aleatorios |
| `PANEL_BASE_URL` | tu dominio, `https://tu-proyecto.vercel.app` (ver abajo) |
| `TWELVEDATA_API_KEY`, `COINGECKO_DEMO_KEY` | las mismas que en GitHub Secrets (para el botón «Comprobar») |

> **Las funciones Python no dependen de esa casilla.** `web/api/_vendor/vigilante`
> es una copia commiteada del paquete del bot, porque Vercel construye las
> funciones Python partiendo del checkout de git y no ve lo que genera el build de
> Next. La regenera `node scripts/vendor.mjs` y `tests/test_vendor.py` comprueba
> por sha256 que no se desvía del original.
>
> Si algún día `/api/validate` falla, **ábrela en el navegador**: contesta con un
> JSON diciendo si está viva, con qué versión de Python y, si no arranca, el
> traceback y las rutas donde buscó el paquete.

> **Por qué `PANEL_BASE_URL`.** El panel llama a sus funciones Python por HTTP, y
> Vercel no tiene bucle interno: la petición sale al edge y vuelve a entrar. Por
> defecto se usaría `VERCEL_URL`, que es la URL del **despliegue concreto** —esa sí
> la cubre la protección estándar de Vercel, aunque tu dominio de producción esté
> abierto—, y la llamada recibe la pantalla de autenticación en vez de JSON.
> Apuntando explícitamente a tu dominio, el problema desaparece sin tocar la
> protección.

### 4. Tres ajustes que, si faltan, dan problemas raros

1. **Deployment Protection → Vercel Authentication, para Preview.** Cada push crea
   una URL de vista previa que lleva dentro el `GITHUB_TOKEN`. Sin esto es un panel
   abierto a internet con permiso de escritura en tu repositorio. **Actívalo antes
   del primer push.**
2. **Ignored Build Step** (*Settings → Git*):
   ```bash
   git diff --quiet HEAD^ HEAD -- web/ schema/ && exit 0 || exit 1
   ```
   Sin esto, cuando actives el cron el bot commiteará el estado hasta 48 veces al
   día y cada commit redesplegaría el panel.
3. **Firewall → Rate Limiting**: `/login`, método `POST`, 10 peticiones por minuto
   por IP. Actúa en el borde, antes de ejecutar nada.

### 5. Comprueba que funciona

1. Abre el panel en **ventana de incógnito**: debe mandarte al login. Si entra
   directo, `proxy.ts` no se ha cargado.
2. Entra con la contraseña y **guarda sin cambiar nada**: el diff en GitHub debe
   salir vacío. Es la prueba de que los comentarios del YAML sobreviven.
3. Abre **dos pestañas**, edita en las dos y guarda en ambas. La segunda debe
   avisar de que alguien guardó mientras editabas, **no** pisar el cambio.

### 6. El despertador (opcional pero muy recomendable)

El `schedule` de GitHub Actions no es fiable. Medido en este repositorio: de 11
ejecuciones programadas se disparó **1**, y esa con 9 minutos de retraso. Y el
centinela detecta cruces comparando una ejecución con la anterior, así que un
precio que cruza tu umbral y vuelve dentro del rango entre dos ejecuciones no
avisa tarde: **no avisa**.

La ruta `/api/latido` existe para eso. Un servicio de cron externo la llama y
ella le pide a GitHub que ejecute el centinela ahora.

```bash
node scripts/gen-latido.mjs
```

Te imprime `LATIDO_TOKEN=…` para pegar en Vercel (Production, y redesplegar) y
los datos de la tarea en [cron-job.org](https://cron-job.org) (gratis):

| | |
|---|---|
| URL | `https://TU-PANEL.vercel.app/api/latido` |
| Intervalo | cada 30 minutos |
| Cabecera | `x-latido-token: <la clave>` |

El servicio externo **no recibe el token de GitHub**: solo una clave que sirve
para una única cosa, pedir una comprobación de precios. Y aunque se filtrara, la
ruta ignora las peticiones si el centinela ya se ejecutó hace menos de 10 min.

`GITHUB_TOKEN` necesita permiso de **Actions (lectura y escritura)**; si falta,
la ruta responde 502 diciéndolo. El cron de GitHub se deja puesto: esto es la
red, no el sustituto. Comprueba que funciona abriendo la URL sin la clave en el
navegador — debe contestar `401`, no la página del panel.

## Desarrollo local

```bash
cd web
npm install
npm test           # corpus compartido con el bot, YAML y contraseña
npm run typecheck
npm run dev
```

Necesita las mismas variables de entorno en `web/.env.local` (que está en
`.gitignore`); `node scripts/gen-secrets.mjs` (desde `web/`) te da tres de ellas en el formato
correcto. Sin `GITHUB_TOKEN` válido el login funciona pero el panel no puede leer
la configuración.

## Cómo está montado

```
app/
  page.tsx            panel: tarjetas de activos con precio, zona y umbrales
  login/              contraseña compartida
  actions/config.ts   Server Actions: cargar, guardar, comprobar
api/
  validate.py         LA PUERTA: ejecuta el pydantic del bot
  probe.py            el botón «Comprobar»: pide el precio de verdad
lib/
  github.ts           lectura y escritura por la API de GitHub
  yaml.ts             escritor que CONSERVA los comentarios del fichero
  crossChecks.ts      las reglas que JSON Schema no sabe expresar
  schema.ts           ajv, solo para marcar errores mientras se escribe
data/catalog.json     41 activos frecuentes: nombre legible -> proveedor + símbolo
```

### Tres decisiones que explican casi todo

**La validación no está duplicada.** Un formulario que valide en TypeScript acaba
separándose de pydantic, y el día que se separa el bot deja de leer su propia
configuración. Aquí la puerta autoritativa es `api/validate.py`, que importa
`vigilante.config.load_config` — literalmente la misma función que ejecuta el
cron. Lo de TypeScript es solo para marcar errores mientras se escribe.

Y como respaldo, `schema/cases.json` es un corpus de casos que se ejecuta desde
los dos lados: si alguna vez dan veredictos distintos, salta un test en lugar de
romperse una alerta.

**El escritor de YAML conserva los comentarios.** `config/assets.yml` está lleno de
explicaciones («el id de CoinGecko, no el ticker», «4 días: cubre fin de semana
largo»). Un `YAML.stringify` las borraría todas en el primer guardado.

**Los dos conflictos de guardado no son el mismo.** GitHub devuelve el mismo código
si el fichero cambió de verdad que si la rama se movió por un commit del bot a
`state/`. Reintentar el primero pisaría el trabajo de otra persona, así que se
distinguen releyendo el sha: el segundo se reintenta, el primero se avisa.

## Lo que el panel no hace

- **No dispara el centinela.** Guarda la configuración; el cron la usa en su
  siguiente ejecución.
- **No edita los `defaults` ni los proveedores.** Eso sigue siendo cosa del YAML.
- **No enseña gráficos todavía.** El bot ya está acumulando historial en
  `history/`, que es lo que hará falta cuando llegue el análisis de volatilidad.
