"use client";

import { useState } from "react";
import { buscarMonedasAction, type Candidata } from "@/app/actions/config";

/**
 * Elegir una moneda de una lista real en vez de teclear su id.
 *
 * Teclear el id a mano es la parte insegura del panel. Hay docenas de memecoins
 * con nombres casi iguales, y una letra de más no da error: apunta a OTRA moneda
 * que sí existe. El bot la vigilaría durante meses sin que nada pareciera roto.
 *
 * Por eso cada resultado muestra el ticker y el puesto por capitalización: una
 * copia del nombre famoso casi siempre viene sin puesto, y eso se ve de un
 * vistazo sin tener que ir al mercado a comprobarlo.
 */
export function BuscadorMoneda({ onPick }: { onPick: (moneda: Candidata) => void }) {
  const [termino, setTermino] = useState("");
  const [monedas, setMonedas] = useState<Candidata[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  async function buscar() {
    setBuscando(true);
    setError(null);
    setMonedas(null);
    const resultado = await buscarMonedasAction(termino);
    if (resultado.ok) setMonedas(resultado.monedas);
    else setError(resultado.error);
    setBuscando(false);
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      <label htmlFor="buscar-cripto">Buscar una cripto en CoinGecko</label>
      <div className="row">
        <div className="grow">
          <input
            id="buscar-cripto"
            type="text"
            placeholder="marscoin, pepe, dogwifhat…"
            value={termino}
            onChange={(event) => setTermino(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void buscar();
              }
            }}
          />
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button type="button" onClick={() => void buscar()} disabled={buscando || termino.trim().length < 2}>
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </div>
      </div>

      {error && (
        <p className="aviso aviso-error" style={{ marginTop: "0.6rem" }}>
          {error}
        </p>
      )}

      {monedas !== null && monedas.length === 0 && (
        <p className="muted" style={{ marginTop: "0.6rem" }}>
          CoinGecko no conoce ninguna moneda con ese nombre. Prueba con el nombre completo, o con
          su ticker.
        </p>
      )}

      {monedas !== null && monedas.length > 0 && (
        <>
          <p className="muted" style={{ margin: "0.6rem 0 0.3rem" }}>
            {monedas.length} resultado(s). Fíjate en el ticker y en el puesto: varias monedas
            distintas pueden llamarse casi igual.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {monedas.map((moneda) => (
              <li key={moneda.id}>
                <button
                  type="button"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    marginBottom: "0.3rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.6rem",
                  }}
                  onClick={() => onPick(moneda)}
                >
                  {moneda.imagen && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={moneda.imagen} alt="" width={20} height={20} style={{ borderRadius: "50%" }} />
                  )}
                  <span className="grow">
                    <strong>{moneda.nombre}</strong> <span className="muted">{moneda.ticker}</span>
                  </span>
                  <span className="muted">
                    {moneda.rango === null ? "sin puesto" : `nº ${moneda.rango}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: "0.4rem", fontSize: "0.85em" }}>
            «Sin puesto» significa que es demasiado pequeña para entrar en el ranking por
            capitalización. No es necesariamente falsa, pero si esperabas una moneda conocida, es
            la señal de que has dado con una copia del nombre.
          </p>
        </>
      )}
    </div>
  );
}
