"""Cliente HTTP compartido: timeouts, reintentos y errores tipados.

Un vigilante desatendido no puede quedarse colgado en un socket ni tumbarse por
un 502 pasajero, pero tampoco debe insistir tanto que agote la cuota.
"""

from __future__ import annotations

import random
import time
from typing import Any, Mapping

import requests

from ..errors import ProviderError, RateLimited

USER_AGENT = "vigilante-precios/0.1 (+https://github.com/StefaNovaliere/controler-activos)"

#: Se reintenta lo que suele arreglarse solo. Un 4xx (salvo 429) no se reintenta:
#: si el símbolo está mal escrito, insistir solo gasta cuota.
_RETRY_STATUS = frozenset({429, 500, 502, 503, 504})

#: Cuánto se acepta esperar cuando el servidor dice cuándo volver. Por encima de
#: esto no se espera: se abandona y se deja para la siguiente ejecución del cron,
#: que llega en minutos. El trabajo entero tiene 10 minutos de límite y quedarse
#: dormido en un socket es la forma de agotarlos sin haber consultado nada.
_MAX_ESPERA_INDICADA = 25.0


class HttpClient:
    def __init__(self, *, timeout: float = 15.0, retries: int = 2) -> None:
        self.timeout = timeout
        self.retries = retries
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"})

    def get(
        self,
        url: str,
        *,
        provider: str,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> requests.Response:
        last: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                response = self._session.get(
                    url, params=params, headers=dict(headers or {}), timeout=self.timeout
                )
            except requests.RequestException as exc:
                last = ProviderError(f"fallo de red: {exc}", provider=provider)
            else:
                if response.status_code == 429:
                    last = RateLimited(
                        "cuota agotada (HTTP 429)",
                        provider=provider,
                        retry_after=_retry_after(response),
                    )
                elif response.status_code in _RETRY_STATUS:
                    last = ProviderError(f"HTTP {response.status_code}", provider=provider)
                elif not response.ok:
                    # Error definitivo: no insistir.
                    raise ProviderError(
                        f"HTTP {response.status_code}: {response.text[:200]}", provider=provider
                    )
                else:
                    return response

            if attempt >= self.retries:
                break

            # Si el servidor dijo CUÁNDO volver, se le hace caso. Antes se leía
            # la cabecera `Retry-After` para el mensaje de error y luego se
            # esperaba lo de siempre: ante un «vuelve en 30 s» se reintentaba a
            # 1 s y a 2 s, gastando dos peticiones de la cuota para fallar las
            # dos veces. Insistir antes de tiempo contra un límite de cuota es
            # justo lo que lo empeora.
            indicada = last.retry_after if isinstance(last, RateLimited) else None
            if indicada is not None:
                if indicada > _MAX_ESPERA_INDICADA:
                    break  # demasiado: mejor la próxima ejecución del cron
                time.sleep(indicada + random.uniform(0, 0.4))
            else:
                time.sleep(min(2**attempt + random.uniform(0, 0.4), 8.0))

        raise last or ProviderError("fallo desconocido", provider=provider)

    def close(self) -> None:
        self._session.close()


def _retry_after(response: requests.Response) -> int | None:
    try:
        return int(response.headers.get("Retry-After", ""))
    except (TypeError, ValueError):
        return None
