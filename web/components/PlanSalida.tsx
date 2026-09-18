"use client";

import { money } from "@/lib/format";
import { normalizar, numeroDe } from "./ThresholdField";
import { redondear } from "@/lib/mercado";
import type { AssetInput } from "@/lib/types";

type Tramo = NonNullable<AssetInput["exits"]>[number];

/**
 * El plan de salida: «vendo un cuarto a 2x, otro cuarto a 3x».
 *
 * Es la parte del panel que más se parece a un tutor, y no porque prediga nada:
 * porque te obliga a decidir la salida ANTES de entrar. El momento de máxima
 * euforia es exactamente cuando peor decides, y un plan escrito en frío es lo
 * único que sobrevive a ese momento.
 *
 * Cada objetivo suena UNA vez. Cuando vendes el tramo de 2x ese aviso no vuelve
 * aunque el precio baje y suba otra vez: ya no tienes esa parte.
 */
type Props = {
  asset: AssetInput;
  precio: number | null;
  onChange: (cambios: Partial<AssetInput>) => void;
};

export function PlanSalida({ asset, precio, onChange }: Props) {
  const tramos = asset.exits ?? [];
  const entrada = numeroDe(asset.entry_price ?? null);

  const setTramos = (nuevos: Tramo[]) => onChange({ exits: nuevos });
  const editar = (i: number, cambios: Partial<Tramo>) =>
    setTramos(tramos.map((t, j) => (j === i ? { ...t, ...cambios } : t)));

  const vendido = tramos.reduce((suma, t) => suma + (numeroDe(t.sell_pct) ?? 0), 0);

  /** El plan que usaría la mayoría: recuperas lo puesto pronto y dejas correr
   *  el resto. No es una recomendación de inversión, es un punto de partida
   *  mejor que la hoja en blanco. */
  function plantilla() {
    const base = entrada ?? precio;
    if (base === null) return;
    setTramos([
      { price: String(redondear(base * 2)), sell_pct: "25", note: "recupero lo invertido" },
      { price: String(redondear(base * 3)), sell_pct: "25", note: null },
      { price: String(redondear(base * 5)), sell_pct: "25", note: null },
    ]);
  }

  return (
    <fieldset style={{ marginTop: "0.85rem" }}>
      <legend>Plan de salida</legend>
      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
        Decide ahora, en frío, a qué precios vendes y cuánto. Cada objetivo te avisa{" "}
        <strong>una sola vez</strong>: ese tramo ya está vendido.
      </p>

      <div className="row">
        <div className="grow">
          <label htmlFor={`entrada-${asset.id}`}>Precio al que compraste (opcional)</label>
          <input
            id={`entrada-${asset.id}`}
            type="text"
            inputMode="decimal"
            placeholder={precio !== null ? String(redondear(precio)) : ""}
            value={asset.entry_price ?? ""}
            onChange={(e) => onChange({ entry_price: normalizar(e.target.value) || null })}
          />
        </div>
      </div>
      <p className="muted" style={{ margin: "0.3rem 0 0", fontSize: "0.85em" }}>
        Con esto el panel te habla en múltiplos («2x») en vez de en precios sueltos, y el aviso de
        Telegram también.
      </p>

      {tramos.length === 0 ? (
        <div style={{ marginTop: "0.8rem" }}>
          <button type="button" onClick={() => setTramos([{ price: "", sell_pct: "25", note: null }])}>
            + Añadir un objetivo
          </button>
          {(entrada ?? precio) !== null && (
            <button type="button" onClick={plantilla} style={{ marginLeft: "0.5rem" }}>
              Empezar con 2x · 3x · 5x
            </button>
          )}
        </div>
      ) : (
        <>
          <table style={{ width: "100%", marginTop: "0.8rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", fontWeight: 500 }} className="muted">Vender a</th>
                <th style={{ textAlign: "left", fontWeight: 500, width: "5.5rem" }} className="muted">Qué parte</th>
                <th style={{ textAlign: "left", fontWeight: 500 }} className="muted">Nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tramos.map((tramo, i) => {
                const objetivo = numeroDe(tramo.price);
                const multiplo = entrada !== null && objetivo !== null && entrada > 0 ? objetivo / entrada : null;
                return (
                  <tr key={i}>
                    <td style={{ paddingRight: "0.4rem" }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Precio del objetivo ${i + 1}`}
                        value={tramo.price}
                        onChange={(e) => editar(i, { price: normalizar(e.target.value) })}
                        style={{ width: "100%" }}
                      />
                      {multiplo !== null && (
                        <span className="muted" style={{ fontSize: "0.8em" }}>
                          {multiplo.toFixed(multiplo >= 10 ? 0 : 1).replace(".", ",")}x
                        </span>
                      )}
                    </td>
                    <td style={{ paddingRight: "0.4rem" }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Parte a vender en el objetivo ${i + 1}`}
                        value={tramo.sell_pct ?? ""}
                        onChange={(e) => editar(i, { sell_pct: normalizar(e.target.value) || null })}
                        style={{ width: "100%", textAlign: "right" }}
                      />
                    </td>
                    <td style={{ paddingRight: "0.4rem" }}>
                      <input
                        type="text"
                        aria-label={`Nota del objetivo ${i + 1}`}
                        placeholder="por qué este precio"
                        value={tramo.note ?? ""}
                        onChange={(e) => editar(i, { note: e.target.value || null })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link"
                        aria-label={`Quitar el objetivo ${i + 1}`}
                        onClick={() => setTramos(tramos.filter((_, j) => j !== i))}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="row" style={{ marginTop: "0.6rem", alignItems: "center" }}>
            <button
              type="button"
              onClick={() => setTramos([...tramos, { price: "", sell_pct: null, note: null }])}
            >
              + Otro objetivo
            </button>
            <span className="muted" style={{ marginLeft: "0.8rem" }}>
              {vendido > 0 ? (
                <>
                  Vendes el <strong>{Math.round(vendido)} %</strong> escalonado
                  {vendido < 100 && <> y dejas correr el {Math.round(100 - vendido)} %</>}.
                </>
              ) : (
                <>Sin repartir: pon qué parte vendes en cada objetivo.</>
              )}
            </span>
          </div>

          {entrada !== null && precio !== null && (
            <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85em" }}>
              Compraste a {money(entrada, asset.currency)} y ahora vale {money(precio, asset.currency)}:{" "}
              vas {precio >= entrada ? "+" : "−"}
              {Math.abs(((precio - entrada) / entrada) * 100).toFixed(1).replace(".", ",")} %.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
