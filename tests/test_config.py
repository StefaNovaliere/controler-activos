"""La configuración se valida al arrancar: una errata no puede costar una alerta."""

from __future__ import annotations

from decimal import Decimal

import pytest

from vigilante.config import load_config
from vigilante.errors import ConfigError
from vigilante.providers import unknown_providers

BASE = """
version: 1
providers:
  stooq: {}
notifier:
  telegram: {}
assets:
  - {id: oro, provider: stooq, symbol: xauusd, lower: 3000, upper: 4200}
"""


def _write(tmp_path, text: str):
    path = tmp_path / "assets.yml"
    path.write_text(text, encoding="utf-8")
    return path


def test_la_configuracion_real_del_repositorio_es_valida():
    """El fichero que edita el usuario desde el panel tiene que seguir cargando.

    Se comprueba que es válido, NO qué activos lleva: eso lo cambia el usuario
    cada vez que usa el panel, y un test atado a su contenido pondría CI en rojo
    por el mero hecho de usar el producto.
    """
    config = load_config("config/assets.yml")

    assert config.assets, "debe quedar al menos un activo habilitado"
    assert not unknown_providers(config), "algún proveedor no existe en el registro"
    for asset in config.assets:
        assert asset.lower is not None or asset.upper is not None
        if asset.lower is not None and asset.upper is not None:
            assert asset.lower < asset.upper


def test_los_activos_deshabilitados_quedan_fuera(tmp_path):
    texto = BASE + "  - {id: pausado, provider: stooq, symbol: xagusd, lower: 20, enabled: false}\n"
    config = load_config(_write(tmp_path, texto))
    assert "pausado" not in {a.id for a in config.assets}


def test_los_defaults_se_aplican_a_los_activos(tmp_path):
    config = load_config(_write(tmp_path, BASE))
    oro = config.assets[0]
    assert oro.cooldown_minutes == 180
    assert oro.hysteresis_pct == Decimal("0.25")
    assert oro.label == "ORO", "sin label se usa el id"


def test_un_override_gana_al_default(tmp_path):
    text = BASE.replace("upper: 4200}", "upper: 4200, cooldown_minutes: 15, notify_on_return: false}")
    config = load_config(_write(tmp_path, text))
    assert config.assets[0].cooldown_minutes == 15
    assert config.assets[0].notify_on_return is False


@pytest.mark.parametrize(
    "mutacion,fragmento",
    [
        ("lower: 3000, upper: 4200}", "lower: 5000, upper: 4200}"),
        ("lower: 3000, upper: 4200}", "}"),
    ],
    ids=["lower_mayor_que_upper", "sin_ningun_umbral"],
)
def test_umbrales_incoherentes(tmp_path, mutacion, fragmento):
    with pytest.raises(ConfigError):
        load_config(_write(tmp_path, BASE.replace(mutacion, fragmento)))


def test_id_duplicado(tmp_path):
    text = BASE + "  - {id: oro, provider: stooq, symbol: xagusd, lower: 20}\n"
    with pytest.raises(ConfigError, match="duplicado"):
        load_config(_write(tmp_path, text))


def test_proveedor_no_declarado(tmp_path):
    text = BASE.replace("provider: stooq, symbol: xauusd", "provider: inventado, symbol: xauusd")
    with pytest.raises(ConfigError, match="inventado"):
        load_config(_write(tmp_path, text))


def test_clave_desconocida_en_el_yaml(tmp_path):
    """Una errata como `lowerr:` debe cantar, no ignorarse en silencio."""
    text = BASE.replace("lower: 3000", "lowerr: 3000")
    with pytest.raises(ConfigError):
        load_config(_write(tmp_path, text))


def test_ningun_activo_habilitado(tmp_path):
    text = BASE.replace("upper: 4200}", "upper: 4200, enabled: false}")
    with pytest.raises(ConfigError, match="habilitado"):
        load_config(_write(tmp_path, text))


def test_yaml_roto(tmp_path):
    with pytest.raises(ConfigError, match="YAML"):
        load_config(_write(tmp_path, "version: 1\nassets: [ {"))


def test_fichero_inexistente():
    with pytest.raises(ConfigError, match="no existe"):
        load_config("no/existe.yml")


def test_variables_de_entorno_ausentes_se_listan(tmp_path, monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    config = load_config(_write(tmp_path, BASE))
    assert config.missing_env() == ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]


def test_la_huella_ignora_los_ceros_de_mas(tmp_path):
    a = load_config(_write(tmp_path, BASE)).assets[0]
    b = load_config(_write(tmp_path, BASE.replace("lower: 3000", "lower: 3000.00"))).assets[0]
    assert a.fingerprint() == b.fingerprint()


def test_la_huella_cambia_al_mover_un_umbral(tmp_path):
    a = load_config(_write(tmp_path, BASE)).assets[0]
    b = load_config(_write(tmp_path, BASE.replace("lower: 3000", "lower: 3100"))).assets[0]
    assert a.fingerprint() != b.fingerprint()
