# Centinela de precios

Avisa por Telegram cuando un activo que te interesa **cruza** un umbral que tú has
fijado, por arriba o por abajo. Vigila criptomonedas, acciones/ETFs, divisas y
materias primas, y se ejecuta solo en GitHub Actions: no necesitas servidor, ni
dejar el ordenador encendido, ni pagar nada.

La palabra clave es *cruza*. No te escribe cada media hora mientras el precio siga
bajo; te escribe **en la transición**, que es cuando hay algo que decidir.

```
🔻 Bitcoin ha cruzado por DEBAJO de 55 000.00 USD
    Ahora: 53 210.00 USD · cruzó hace 45 min a 54 980.00

✅ EUR/USD ha vuelto al rango (por encima de 1.02 USD)
    Ahora: 1.0450 USD
```

## Puesta en marcha

### 1. Crea el bot de Telegram (2 min)

1. Habla con [@BotFather](https://t.me/BotFather) y envía `/newbot`.
2. Te devuelve un **token** con la forma `123456789:AA...`. Guárdalo.
3. **Escríbele algo a tu bot** (un «hola» vale). Telegram no deja que un bot inicie
   una conversación, así que este mensaje es lo que abre el canal.

   > **Ojo: el bot no te va a contestar.** No responde a mensajes ni a comandos. Solo
   > habla él, y solo cuando un activo cruza uno de tus umbrales. Su silencio ahora
   > es lo normal.

4. Averigua tu **chat id**: habla con [@userinfobot](https://t.me/userinfobot), o abre
   `https://api.telegram.org/bot<TU_TOKEN>/getUpdates` y busca `"chat":{"id":...}`.

### 2. Saca las claves de datos (gratuitas, sin tarjeta)

| Clave | Para qué | Dónde | Límite gratuito |
|---|---|---|---|
| `TWELVEDATA_API_KEY` | Acciones y ETFs | [twelvedata.com](https://twelvedata.com/pricing) | 800 créditos/día, 8/min |
| `COINGECKO_DEMO_KEY` | Criptomonedas | [coingecko.com](https://www.coingecko.com/en/developers/dashboard) | 10 000 llamadas/mes |

Ninguna de las dos es imprescindible para arrancar:

- Sin `COINGECKO_DEMO_KEY` funciona igual, en modo *keyless*, pero el límite es por
  IP y los runners de GitHub comparten IP con mucha gente: verás algún 429.
- Sin `TWELVEDATA_API_KEY` no puedes vigilar acciones con ese proveedor; pásalas a
  `stooq`, que no pide clave (a cambio de más retardo).

**Stooq no necesita clave** y cubre oro, petróleo, divisas, índices y acciones.

### 3. Guarda los secretos en GitHub

*Settings → Secrets and variables → Actions → New repository secret*:

```
TELEGRAM_BOT_TOKEN     TELEGRAM_CHAT_ID     TWELVEDATA_API_KEY     COINGECKO_DEMO_KEY
```

### 4. Elige qué vigilar

Hay dos formas. Si vas a compartir esto con alguien que no programa, despliega el
**[panel web](web/README.md)**: entra con una contraseña, ve el precio y la zona de
cada activo, y edita los umbrales con un formulario, sin ver un YAML en su vida.

A mano, edita [`config/assets.yml`](config/assets.yml):

```yaml
assets:
  - id: btc
    label: "Bitcoin"
    provider: coingecko
    symbol: bitcoin        # el id de CoinGecko, no el ticker
    currency: usd
    lower: 55000           # avísame si baja de aquí
    upper: 95000           # ...o si sube de aquí
```

Los dos umbrales son independientes: pon `upper: null` para vigilar solo las
caídas. Y `enabled: false` deja un activo guardado pero apagado.

Símbolos útiles de Stooq: `xauusd` (oro), `xagusd` (plata), `cl.f` (WTI),
`cb.f` (Brent), `ng.f` (gas), `eurusd`, `usdjpy`, `aapl.us`, `spy.us`, `^spx`.

### 5. Arranca

1. *Actions → centinela → Run workflow* con **`test_message: true`**. En
   segundos debe llegarte un mensaje de prueba a Telegram. Si llega, tus credenciales
   son correctas y ya no tienes que volver a dudar de ellas.
2. Repite con **`dry_run: true`**. Esto consulta los precios de verdad y valida las
   claves de datos y la salida de red del runner, sin enviarte nada ni escribir
   estado. Mira la tabla del resumen de la ejecución: te dice el precio y la zona de
   cada activo.
3. Repite sin marcar nada. Ahora sí te escribirá **si hay algo que contar** (ver
   abajo: puede acabar en verde y no mandarte nada, y estar todo bien).

A partir de ahí corre solo cada 30 minutos, en el minuto 7 y 37. Ese desfase es
deliberado: GitHub encola los crons y las horas en punto y las medias son los dos
momentos de más congestión, porque es cuando todo el mundo programa sus tareas.

> **En repositorio privado el cron cuesta cuota.** GitHub factura cada ejecución
> redondeando al minuto, así que 48 al día son ~1.440 de los 2.000 minutos
> mensuales del plan gratuito. En repositorio público no se factura nada.

Deja pasar 24 h antes de bajar el intervalo a 15 minutos: el resumen de cada
ejecución te dice cuántos símbolos estás gastando.

## Uso local

```bash
pip install -e ".[dev]"

vigilante check                      # valida la configuración sin tocar la red
vigilante run --dry-run              # precios reales, sin enviar ni persistir
vigilante run --console              # imprime el mensaje en vez de mandarlo
vigilante test-telegram              # comprueba token y chat_id de una vez

# Inyecta precios y reloj: recorre el ciclo de vida de una alerta sin esperar al cron
vigilante simulate --state /tmp/s.json --prices "btc=50000" --now 2026-09-17T10:00:00Z
vigilante simulate --state /tmp/s.json --prices "btc=53000" --now 2026-09-17T11:00:00Z
vigilante simulate --state /tmp/s.json --prices "btc=56000" --now 2026-09-17T11:30:00Z
```

## Cómo decide si avisarte

Cada activo está en una de tres zonas: **por debajo**, **dentro** o **por encima**.
Solo se manda mensaje cuando cambia de zona.

| Pasa de | a | ¿Te escribe? |
|---|---|---|
| dentro | por debajo / por encima | Sí |
| por debajo / por encima | dentro | Sí (`notify_on_return`) |
| por debajo | por encima (o al revés) | Sí, **siempre**: ignora el cooldown |
| la misma zona | la misma zona | No |

Encima de eso hay cuatro protecciones, todas configurables:

- **Cooldown** (`cooldown_minutes`): silencia avisos repetidos del mismo activo. No
  los descarta — los retiene y los suelta agrupados cuando vence, diciéndote desde
  cuándo y a qué precio cruzó.
- **Histéresis** (`hysteresis_pct`): para dar por vuelto al rango no basta con rozar
  el umbral, hay que recuperar un margen. Sin esto, un precio oscilando sobre la
  frontera te escribiría veinte veces.
- **Datos rancios** (`max_staleness_minutes`): un precio demasiado viejo se trata
  como un fallo, no como un precio. Así el cierre del viernes no te dispara una
  "recuperación" el domingo. Para acciones conviene subirlo (4 días cubre un puente).
- **Cambios de configuración**: si mueves un umbral, el activo se reevalúa desde
  cero. Si no, subir el listón y que el bot siguiera callado porque "ya estaba por
  debajo" sería un fallo silencioso.

En el **primer arranque** recibes un resumen de qué activos ya están fuera de rango
(`first_run_policy`: `summary` por defecto, `none` para no recibir nada, `full` para
el detalle de cada uno).

## Por qué el estado se commitea al repositorio

Los runners de GitHub Actions son efímeros: al terminar, desaparece todo. Para
saber si un precio *acaba de cruzar* hay que recordar dónde estaba antes, así que
`state/state.json` se commitea al repo en cada ejecución que cambie algo.

Se descartaron las dos alternativas:

- **`actions/cache`**: las entradas son inmutables, se desalojan a los 7 días sin uso
  y están ligadas a la rama. Perder la caché significa avisos duplicados o perdidos,
  en silencio y sin forma de depurarlo.
- **Artifacts**: para leer el estado anterior hay que buscar por API la última
  ejecución correcta; si una falló, lees un estado atrasado.

Commitear es durable, auditable (`git log state/state.json` te cuenta la historia de
cada cruce) y no genera bucles: un push hecho con el `GITHUB_TOKEN` del propio
workflow no dispara otros workflows. De regalo, esos commits evitan que GitHub
desactive el cron por 60 días de inactividad. Si no cambia nada, no se commitea.

## Detalles que quizá te sorprendan

- **Un 429 de un proveedor no pone el repositorio en rojo.** Si lo hiciera, el repo
  viviría en rojo y acabarías ignorando los avisos de GitHub justo cuando uno
  importe. El job solo falla si no se pudo *entregar* la notificación.
- **Si Telegram falla, el estado no se guarda** para los activos afectados: el cruce
  se vuelve a detectar en la siguiente ejecución. Mejor un aviso duplicado que uno
  perdido.
- **Un proveedor caído no corrompe nada.** Un error nunca toca la zona ni los relojes
  de aviso; solo cuenta fallos, y te avisa si un activo lleva demasiado tiempo a
  ciegas.
- **Los crons de GitHub se retrasan** hasta 10-20 minutos bajo carga. No pasa nada:
  todo se basa en comparar zonas, nunca en asumir un intervalo exacto.
- **yfinance no se usa.** Raspa endpoints internos de Yahoo y desde IPs de centro de
  datos (los runners) da 429 sistemáticos. Para un centinela desatendido es frágil.

## Problemas frecuentes

**Le escribo al bot y no me contesta.**
Es lo esperado, no hay nada roto. El bot no escucha: no hay ningún proceso corriendo.
Solo se despierta cuando se ejecuta el workflow, y solo habla si un activo ha cruzado
un umbral. Para comprobar que la conexión funciona, usa *Run workflow* con
`test_message: true`.

**`getUpdates` me devuelve `{"ok":true,"result":[]}`.**
Tres causas, por orden de probabilidad: escribiste a otro bot de nombre parecido (el
token y el chat tienen que ser del mismo); ya consumiste ese update en una llamada
anterior (vuelve a escribirle y recarga); o hay un webhook configurado que se está
quedando los mensajes — bórralo con
`https://api.telegram.org/bot<TU_TOKEN>/deleteWebhook` y prueba otra vez.

**El workflow acaba en verde y no me llega nada.**
Normal si ningún activo cruzó un umbral. El resumen de la ejecución te enseña el
precio y la zona de cada activo: si todos ponen `inside`, no hay nada que anunciar.
Cuidado con `force_notify`: salta el cooldown, pero **no inventa cruces**. Si quieres
provocar una alerta de verdad para verla, aprieta temporalmente un umbral en
`config/assets.yml` hasta dejar el precio actual fuera de rango.

**`Telegram respondió 400: chat not found`.**
El `TELEGRAM_CHAT_ID` no es correcto, o pertenece a una conversación con otro bot
distinto del que generó el token.

**El cron no se ejecuta.**
¿Descomentaste el bloque `schedule`? Y ten en cuenta que GitHub retrasa los crons
hasta 10-20 minutos bajo carga: la primera ejecución puede no ser puntual.

## Arquitectura

```
config/assets.yml            lo único que editas (a mano o desde el panel)
state/state.json             la memoria entre ejecuciones
history/prices-YYYY.csv      historial de precios, para el análisis futuro
schema/                      contrato compartido entre el bot y el panel
src/vigilante/
  engine.py                  máquina de estados PURA: sin red, sin disco, sin reloj propio
  runner.py                  orquestación y orden de operaciones
  state_store.py             JSON versionado, escritura atómica, serialización determinista
  providers/                 coingecko · twelvedata · stooq
  notifiers/                 telegram · consola
web/                         el panel: ver web/README.md
```

`engine.py` no importa nada de `providers/` ni de `notifiers/`. Añadir una fuente
nueva es escribir un fichero en `providers/` y una línea en el YAML: la lógica de
alertas no se entera.

## Tests

```bash
python -m pytest -q
```

No hay llamadas reales a las APIs en CI: fallarían de forma aleatoria y te
enseñarían a ignorar el rojo. Los proveedores se prueban contra respuestas grabadas
que incluyen sus trampas conocidas (CoinGecko omite los símbolos que no conoce,
Twelve Data manda los errores de cuota con HTTP 200, Stooq escribe `N/D`).

`schema/cases.json` es un corpus de casos de configuración que se ejecuta **desde
los dos lados**, Python y TypeScript. Mientras los dos den el mismo veredicto, la
validación del panel y la del bot no han divergido; el día que divergan, salta un
test en vez de romperse una alerta en silencio.
