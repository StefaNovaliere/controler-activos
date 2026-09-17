"use client";

import { useState } from "react";
import { probarAction } from "@/app/actions/config";
import { KNOWN_PROVIDERS } from "@/lib/schema";
import { money, percent, distanceTo, ZONE_LABEL } from "@/lib/format";
import type { AssetInput, AssetState } from "@/lib/types";
import { ThresholdField } from "./ThresholdField";

type Props = {
  asset: AssetInput;
  estado: AssetState | undefined;
  onChange: (asset: AssetInput) => void;
  onDelete: () => void;
};

export function AssetCard({ asset, estado, onChange, onDelete }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [sondeo, setSondeo] = useState<{ ok: boolean; texto: string } | null>(null);
  const [sondeando, setSondeando] = useState(false);

  const precio = estado?.last_price ? Number(estado.last_price) : null;
  const zona = estado?.zone ?? null;
  const set = (cambios: Partial<AssetInput>) => onChange({ ...asset, ...cambios });

  async function comprobar() {
    setSondeando(true);
    setSondeo(null);
    const result = await probarAction(asset.provider, asset.symbol, asset.currency || "usd");
    setSondeo(
      result.ok
        ? { ok: true, texto: `${money(result.price, result.currency)} · dato del proveedor` }
        : { ok: false, texto: result.error ?? "no se pudo comprobar" },
    );
    setSondeando(false);
  }

  return (
    <article className={`card${asset.enabled ? "" : " paused"}`}>
      <div className="card-head">
        <h2>{asset.label || asset.id}</h2>
        {precio !== null && <span className="price">{money(precio, asset.currency)}</span>}
        <span className={`zone zone-${zona ?? "none"}`}>
          {asset.enabled ? (zona ? ZONE_LABEL[zona] : "sin datos aún") : "en pausa"}
        </span>
        <button type="button" className="link" onClick={() => setAbierto(!abierto)}>
          {abierto ? "Cerrar" : "Editar"}
        </button>
      </div>

      <Resumen asset={asset} precio={precio} />

      {abierto && (
        <>
          <div className="row" style={{ marginTop: "0.85rem" }}>
            <div className="grow">
              <label htmlFor={`label-${asset.id}`}>Nombre</label>
              <input
                id={`label-${asset.id}`}
                type="text"
                value={asset.label}
                onChange={(event) => set({ label: event.target.value })}
              />
            </div>
          </div>

          <ThresholdField
            titulo="Avísame si BAJA de"
            value={asset.lower}
            currency={asset.currency || "usd"}
            precioActual={precio}
            onChange={(lower) => set({ lower })}
          />
          <ThresholdField
            titulo="Avísame si SUBE de"
            value={asset.upper}
            currency={asset.currency || "usd"}
            precioActual={precio}
            onChange={(upper) => set({ upper })}
          />

          <details className="opciones">
            <summary>Configuración avanzada</summary>

            <div className="row" style={{ marginTop: "0.6rem" }}>
              <div className="grow">
                <label htmlFor={`prov-${asset.id}`}>Fuente de datos</label>
                <select
                  id={`prov-${asset.id}`}
                  value={asset.provider}
                  onChange={(event) => set({ provider: event.target.value })}
                >
                  {KNOWN_PROVIDERS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grow">
                <label htmlFor={`sym-${asset.id}`}>Símbolo</label>
                <input
                  id={`sym-${asset.id}`}
                  type="text"
                  value={asset.symbol}
                  onChange={(event) => set({ symbol: event.target.value })}
                />
              </div>
              <div style={{ alignSelf: "flex-end" }}>
                <button type="button" onClick={comprobar} disabled={sondeando}>
                  {sondeando ? "Comprobando…" : "Comprobar"}
                </button>
              </div>
            </div>

            {sondeo && (
              <p className={`aviso ${sondeo.ok ? "aviso-ok" : "aviso-error"}`} style={{ marginTop: "0.6rem" }}>
                {sondeo.ok ? "✓ " : "✗ "}
                {sondeo.texto}
              </p>
            )}

            <div className="row" style={{ marginTop: "0.6rem" }}>
              <div className="grow">
                <label htmlFor={`cd-${asset.id}`}>Silencio mínimo entre avisos</label>
                <select
                  id={`cd-${asset.id}`}
                  value={asset.cooldown_minutes ?? ""}
                  onChange={(event) =>
                    set({ cooldown_minutes: event.target.value ? Number(event.target.value) : null })
                  }
                >
                  <option value="">Por defecto (3 h)</option>
                  {[30, 60, 120, 180, 360, 720, 1440].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${m / 60} h`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grow">
                <label htmlFor={`ret-${asset.id}`}>Avisarme al volver al rango</label>
                <select
                  id={`ret-${asset.id}`}
                  value={String(asset.notify_on_return ?? "")}
                  onChange={(event) =>
                    set({ notify_on_return: event.target.value === "" ? null : event.target.value === "true" })
                  }
                >
                  <option value="">Por defecto (sí)</option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>
          </details>

          <div className="row" style={{ marginTop: "0.85rem" }}>
            <button type="button" onClick={() => set({ enabled: !asset.enabled })}>
              {asset.enabled ? "Pausar" : "Reanudar"}
            </button>
            <button type="button" className="danger" onClick={onDelete}>
              Borrar
            </button>
            <span className="muted">
              Pausar conserva los umbrales; borrar los pierde.
            </span>
          </div>
        </>
      )}
    </article>
  );
}

/** La frase en castellano llano: delata el error de teclear 5 500 por 55 000. */
function Resumen({ asset, precio }: { asset: AssetInput; precio: number | null }) {
  const lower = asset.lower ? Number(asset.lower) : null;
  const upper = asset.upper ? Number(asset.upper) : null;

  if (lower === null && upper === null) {
    return <p className="explica">Sin ningún aviso configurado: este activo no vigila nada.</p>;
  }
  if (precio === null) {
    return (
      <p className="explica">
        Te avisará {lower !== null && <>si baja de <strong>{money(lower, asset.currency)}</strong></>}
        {lower !== null && upper !== null && " o "}
        {upper !== null && <>si sube de <strong>{money(upper, asset.currency)}</strong></>}.
      </p>
    );
  }

  const partes: string[] = [];
  if (lower !== null) partes.push(`si bajara un ${percent(distanceTo(precio, lower))} (hasta ${money(lower)})`);
  if (upper !== null) partes.push(`si subiera un ${percent(distanceTo(precio, upper))} (hasta ${money(upper)})`);

  return (
    <>
      {lower !== null && upper !== null && <Barra precio={precio} lower={lower} upper={upper} />}
      <p className="explica">
        Ahora mismo <strong>{asset.label || asset.id}</strong> está{" "}
        {precio < (lower ?? -Infinity)
          ? "POR DEBAJO del rango"
          : precio > (upper ?? Infinity)
            ? "POR ENCIMA del rango"
            : "DENTRO del rango"}
        . Te avisaría {partes.join(" o ")}.
      </p>
    </>
  );
}

function Barra({ precio, lower, upper }: { precio: number; lower: number; upper: number }) {
  const pct = Math.min(100, Math.max(0, ((precio - lower) / (upper - lower)) * 100));
  return (
    <>
      <div className="bar">
        <span style={{ left: `${pct}%` }} />
      </div>
      <div className="bar-ends">
        <span>{money(lower)}</span>
        <span>{money(upper)}</span>
      </div>
    </>
  );
}
