"""De dónde salen los precios del plan.

* **Binance** (`data-api.binance.vision`, el dominio público de solo-mercado).
  Es la fuente correcta para SUI porque es donde vive la OCO: el stop se dispara
  con el precio de Binance, no con un promedio. Pero Binance bloquea con HTTP 451
  muchas IPs de centros de datos, y los runners de GitHub lo son. Por eso
  siempre con respaldo.
* **CoinGecko**, de respaldo, con `precision=full`. Sin ese parámetro devuelve
  dos decimales a partir de 1 USD: a 1,20 eso es un escalón del 0,8 %, demasiado
  grueso para un SL al 7 %.
* **DexScreener**, para las memes, por dirección de contrato. Sin clave, 300
  consultas por minuto en los endpoints de tokens y pares. Se usa el endpoint
  documentado `/tokens/v1/{cadena}/{direcciones}`, con `/latest/dex/tokens/` de
  respaldo por si el primero cambia.

No se registran en `providers/registry.py` a propósito: ese registro alimenta
el selector del panel, y el panel corre en Vercel, donde Binance daría el mismo
451. Ofrecer allí una fuente que no funciona sería sembrar un error.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Sequence

from ..errors import ProviderError, SymbolNotFound
from ..providers.http import HttpClient
from .motor import Lectura

BINANCE_URL = "https://data-api.binance.vision/api/v3/ticker/price"
COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price"
DEXSCREENER_V1 = "https://api.dexscreener.com/tokens/v1/{cadena}/{direcciones}"
DEXSCREENER_LEGACY = "https://api.dexscreener.com/latest/dex/tokens/{direcciones}"

#: DexScreener acepta hasta 30 direcciones por consulta.
LOTE_DEX = 30


def _decimal(valor: Any, fuente: str, que: str) -> Decimal:
    try:
        d = Decimal(str(valor))
    except (InvalidOperation, TypeError):
        raise ProviderError(f"{que} ilegible: {valor!r}", provider=fuente) from None
    if not d.is_finite() or d <= 0:
        raise ProviderError(f"{que} no positivo: {valor!r}", provider=fuente)
    return d


def _opcional(valor: Any) -> Decimal | None:
    try:
        d = Decimal(str(valor))
    except (InvalidOperation, TypeError):
        return None
    return d if d.is_finite() and d >= 0 else None


class Fuentes:
    def __init__(self, env: Mapping[str, str], http: HttpClient | None = None) -> None:
        self._http = http or HttpClient(timeout=10.0, retries=1)
        self._clave_cg = env.get("COINGECKO_DEMO_KEY") or None

    # ── Binance / CoinGecko ─────────────────────────────────────────────────

    def binance(self, simbolo: str) -> Lectura:
        datos = self._http.get(BINANCE_URL, provider="binance", params={"symbol": simbolo.upper()}).json()
        if not isinstance(datos, dict) or "price" not in datos:
            raise SymbolNotFound(f"respuesta sin precio: {str(datos)[:120]}", provider="binance", symbol=simbolo)
        return Lectura(precio=_decimal(datos["price"], "binance", "precio"), fuente="binance")

    def coingecko(self, simbolo: str) -> Lectura:
        cabeceras = {"x-cg-demo-api-key": self._clave_cg} if self._clave_cg else {}
        datos = self._http.get(
            COINGECKO_URL,
            provider="coingecko",
            params={"ids": simbolo.lower(), "vs_currencies": "usd", "precision": "full"},
            headers=cabeceras,
        ).json()
        entrada = datos.get(simbolo.lower()) if isinstance(datos, dict) else None
        if not isinstance(entrada, dict) or entrada.get("usd") is None:
            raise SymbolNotFound("sin precio en la respuesta", provider="coingecko", symbol=simbolo)
        return Lectura(precio=_decimal(entrada["usd"], "coingecko", "precio"), fuente="coingecko")

    def por_fuente(self, fuente: str, simbolo: str) -> Lectura:
        if fuente == "binance":
            return self.binance(simbolo)
        if fuente == "coingecko":
            return self.coingecko(simbolo)
        raise ProviderError(f"fuente sin consulta por símbolo: {fuente}", provider=fuente)

    # ── DexScreener ─────────────────────────────────────────────────────────

    def dexscreener(self, cadena: str, direcciones: Sequence[str]) -> dict[str, Lectura | ProviderError]:
        """Una lectura por dirección. Un fallo de una no tumba las demás."""
        salida: dict[str, Lectura | ProviderError] = {}
        unicas = list(dict.fromkeys(direcciones))
        for i in range(0, len(unicas), LOTE_DEX):
            lote = unicas[i : i + LOTE_DEX]
            try:
                pares = self._pares(cadena, lote)
            except ProviderError as exc:
                salida.update({d: exc for d in lote})
                continue
            for d in lote:
                salida[d] = agregar(d, cadena, pares)
        return salida

    def _pares(self, cadena: str, lote: list[str]) -> list[dict[str, Any]]:
        unidas = ",".join(lote)
        primero: ProviderError | None = None
        try:
            pares = pares_de(
                self._http.get(DEXSCREENER_V1.format(cadena=cadena, direcciones=unidas), provider="dexscreener").json()
            )
        except (ProviderError, ValueError) as exc:
            primero = exc if isinstance(exc, ProviderError) else ProviderError(f"JSON ilegible: {exc}", provider="dexscreener")
            pares = []
        if pares:
            return pares
        # El endpoint documentado falló, o respondió sin pares (¿cambió de forma?):
        # se prueba el histórico antes de declarar que la dirección no existe.
        try:
            return pares_de(
                self._http.get(DEXSCREENER_LEGACY.format(direcciones=unidas), provider="dexscreener").json()
            )
        except (ProviderError, ValueError):
            if primero is not None:
                raise primero from None
            return []


def pares_de(datos: Any) -> list[dict[str, Any]]:
    """`/tokens/v1` devuelve una lista; `/latest/dex/tokens` un objeto con `pairs`."""
    if isinstance(datos, list):
        return [p for p in datos if isinstance(p, dict)]
    if isinstance(datos, dict) and isinstance(datos.get("pairs"), list):
        return [p for p in datos["pairs"] if isinstance(p, dict)]
    return []


def agregar(direccion: str, cadena: str, pares: list[dict[str, Any]]) -> Lectura | ProviderError:
    """Todos los pares del token, resumidos en una lectura.

    * Precio: el del par con más liquidez, que es el que mueve el mercado.
    * Liquidez: la SUMA de todos sus pares. No la de un par fijo: cuando una
      meme de pump.fun "se gradúa", la liquidez pasa de la curva a un pool
      nuevo. Mirando un solo par, eso parecería un rug pull que no es; sumando,
      la liquidez total apenas cambia.
    """
    propios = [
        p
        for p in pares
        if (p.get("baseToken") or {}).get("address") == direccion
        and (p.get("chainId") in (None, cadena))
    ]
    if not propios:
        return SymbolNotFound(
            "DexScreener no devuelve pares para esta dirección (¿dirección mal copiada, o el par desapareció?)",
            provider="dexscreener",
            symbol=direccion,
        )

    def liquidez(p: dict[str, Any]) -> Decimal | None:
        return _opcional((p.get("liquidity") or {}).get("usd"))

    principal = max(propios, key=lambda p: liquidez(p) or Decimal(-1))
    try:
        precio = _decimal(principal.get("priceUsd"), "dexscreener", "precio")
    except ProviderError as exc:
        exc.symbol = direccion
        return exc

    liquideces = [l for l in (liquidez(p) for p in propios) if l is not None]
    volumenes = [v for v in (_opcional((p.get("volume") or {}).get("h24")) for p in propios) if v is not None]
    return Lectura(
        precio=precio,
        fuente="dexscreener",
        liquidez=sum(liquideces, Decimal(0)) if liquideces else None,
        volumen=sum(volumenes, Decimal(0)) if volumenes else None,
        simbolo_token=str((principal.get("baseToken") or {}).get("symbol") or "")[:20] or None,
    )
