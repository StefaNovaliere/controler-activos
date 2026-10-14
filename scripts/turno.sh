#!/usr/bin/env bash
# Un turno del centinela en GitHub Actions.
#
# Fuera de la ventana del plan: una sola pasada, como siempre.
# Dentro: el job se queda despierto y repite cada CADA_SEGUNDOS (2 min) hasta
# agotar el turno (~5 h 30 min; GitHub corta los jobs a las 6 h).
#
# Por qué un bucle dentro del job y no un cron cada 2 minutos: el cron de GitHub
# no baja de 5 minutos y en la práctica se dispara cada ~4 HORAS (medido en este
# repositorio: del 22/09 al 06/10 corrió unas 6 veces por día). Un aviso de SL
# que llega cuatro horas tarde no es un aviso.
#
# Cadencias dentro del bucle:
#   · plan (SUI + memes):            cada vuelta (2 min)
#   · vigilante permanente:          cada 5 vueltas (10 min), por la cuota de CoinGecko
#   · commit del estado y el historial: cada 5 vueltas, o YA si hubo un aviso o un comando
set -uo pipefail

RAMA="${GITHUB_REF_NAME:?falta GITHUB_REF_NAME}"
DRY="${DRY_RUN:-false}"
CADA="${CADA_SEGUNDOS:-120}"
MARCA="${RUNNER_TEMP:-/tmp}/plan-cambio"
RESUMEN="${GITHUB_STEP_SUMMARY:-/dev/null}"

ARGS_RUN=()
ARGS_PLAN=(--marca "$MARCA")
if [ "$DRY" = "true" ]; then ARGS_RUN+=(--dry-run); ARGS_PLAN+=(--dry-run); fi
if [ "${FORCE_NOTIFY:-false}" = "true" ]; then ARGS_RUN+=(--force-notify); fi

persistir() {
  git config user.name  "centinela-bot"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  # `git add` antes de comparar: en la primera ejecución los ficheros aún no
  # están versionados, y `git diff` a secas ignora lo que no rastrea.
  git add state/ history/ 2>/dev/null || true
  if git diff --cached --quiet -- state/ history/; then
    return 0
  fi
  git commit -q -m "chore(state): $(date -u +%FT%TZ) [skip ci]"
  # Un push con GITHUB_TOKEN no dispara workflows, así que no hay bucle.
  # El pull trae además los cambios de config hechos desde el panel o a mano:
  # el bucle los usa en la vuelta siguiente sin reiniciarse.
  #
  # `-X theirs`: si hay conflicto en state/ o history/, gana lo de ESTE turno
  # (en un rebase, "theirs" son los commits locales que se reaplican). Es el
  # único que escribe ahí mientras dura; lo de fuera es, como mucho, un turno
  # anterior que ya terminó. Y si aun así falla, `rebase --abort`: un rebase a
  # medias deja marcas de conflicto DENTRO de los JSON, y todas las vueltas
  # siguientes fallan al leerlos. Eso es lo que pasó el 14/10.
  for intento in 1 2 3; do
    if git pull -q --rebase -X theirs --autostash origin "$RAMA" && git push -q origin "HEAD:$RAMA"; then
      return 0
    fi
    git rebase --abort >/dev/null 2>&1 || true
    sleep $(( (RANDOM % 5) + 2 ))
  done
  echo "::error::No se pudo persistir el estado tras 3 intentos"
  return 1
}

# Si el propio monitor falla varias vueltas seguidas, decirlo por Telegram una
# vez. El 14/10 estuvo seis horas sin poder leer su estado y nadie se enteró:
# un monitor que falla en silencio es peor que no tener monitor, porque se
# confía en él.
fallos_seguidos=0
avisado=0
avisar_fallo() {
  [ "$DRY" = "true" ] && return 0
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ] && return 0
  local enlace="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/runs/${GITHUB_RUN_ID:-}"
  curl -s -o /dev/null --max-time 15 \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=⚠️ El monitor está fallando desde hace ${fallos_seguidos} vueltas. Los avisos pueden no llegar: mirá tus posiciones a mano. Detalle: ${enlace}" \
    || true
}

duracion=0
if [ -n "${TURNO_SEGUNDOS:-}" ]; then
  duracion="$TURNO_SEGUNDOS" # solo para probar el script en local
elif [ "$DRY" != "true" ] && [ -f config/plan.yml ]; then
  duracion=$(python -m vigilante plan --segundos-bucle) || duracion=0
fi
echo "duracion=$duracion" >> "${GITHUB_OUTPUT:-/dev/null}"
fin=$(( $(date +%s) + duracion ))
echo "Turno de ${duracion} s, una vuelta cada ${CADA} s."

fallo=0
vuelta=0
while :; do
  inicio=$(date +%s)
  resumen=()
  if (( vuelta == 0 )); then resumen=(--summary "$RESUMEN"); fi

  if (( vuelta % 5 == 0 )); then
    python -m vigilante run \
      --config config/assets.yml \
      --state state/state.json \
      "${resumen[@]}" "${ARGS_RUN[@]}" || fallo=1
  fi

  bien=1
  if [ -f config/plan.yml ]; then
    python -m vigilante plan "${resumen[@]}" "${ARGS_PLAN[@]}" || { fallo=1; bien=0; }
  fi

  if [ "$DRY" != "true" ] && { (( vuelta % 5 == 0 )) || [ -f "$MARCA" ]; }; then
    persistir || { fallo=1; bien=0; }
    rm -f "$MARCA"
  fi

  if (( bien )); then
    fallos_seguidos=0
    avisado=0
  else
    fallos_seguidos=$(( fallos_seguidos + 1 ))
    if (( fallos_seguidos >= 3 && ! avisado )); then
      avisar_fallo
      avisado=1
    fi
  fi

  vuelta=$(( vuelta + 1 ))
  ahora=$(date +%s)
  if (( ahora + CADA >= fin )); then
    break
  fi
  espera=$(( CADA - (ahora - inicio) ))
  if (( espera > 0 )); then sleep "$espera"; fi
done

if [ "$DRY" != "true" ]; then
  persistir || fallo=1
else
  # Prueba en seco: además, comprobar que DexScreener responde desde aquí
  # (BONK, un token con liquidez de sobra). Las memes no tienen dirección
  # hasta que se compran, así que sin esto no se probaría hasta el miércoles.
  python -m vigilante plan --sonda-dex DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 --summary "$RESUMEN" || fallo=1
fi
echo "Vueltas: $vuelta"
exit "$fallo"
