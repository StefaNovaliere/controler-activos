"use client";

import { percent, distanceTo } from "@/lib/format";

type Props = {
  titulo: string;
  value: string | null;
  currency: string;
  precioActual: number | null;
  onChange: (value: string | null) => void;
};

/**
 * Un umbral: interruptor + valor absoluto + atajos de porcentaje.
 *
 * Los botones de porcentaje RELLENAN un número absoluto, no guardan un
 * porcentaje. Un umbral relativo al precio de hoy se movería solo mañana, y un
 * umbral que se mueve solo nunca se cruza.
 */
export function ThresholdField({ titulo, value, currency, precioActual, onChange }: Props) {
  // `null` es "desactivado"; `""` es "activado pero vacío". Juntarlos hacía que
  // borrar el último dígito plegara el campo, y vaciarlo es un paso normal
  // mientras se escribe: había que reactivar la casilla, teclear el número
  // detrás del viejo y luego borrar el que estorbaba.
  const activo = value !== null;
  const numero = numeroDe(value);
  const esInferior = titulo.includes("BAJA");
  const signo = esInferior ? -1 : 1;

  function aplicarPorcentaje(pct: number) {
    if (precioActual === null) return;
    const bruto = precioActual * (1 + (signo * pct) / 100);
    onChange(String(redondear(bruto)));
  }

  return (
    <fieldset>
      <legend>
        <label style={{ display: "inline-flex", gap: "0.45rem", alignItems: "center", margin: 0 }}>
          <input
            type="checkbox"
            checked={activo}
            onChange={(event) =>
              onChange(event.target.checked ? sugerencia(precioActual, signo) : null)
            }
          />
          {titulo}
        </label>
      </legend>

      {activo && (
        <>
          <div className="row">
            <input
              className="grow"
              type="text"
              inputMode="decimal"
              value={value ?? ""}
              aria-label={titulo}
              onChange={(event) => onChange(event.target.value)}
            />
            <span className="muted">{currency.toUpperCase()}</span>
          </div>

          {precioActual !== null && (
            <div className="row" style={{ marginTop: "0.5rem" }}>
              <div className="chips">
                {[5, 10, 20].map((pct) => (
                  <button key={pct} type="button" onClick={() => aplicarPorcentaje(pct)}>
                    {esInferior ? "−" : "+"}
                    {pct} %
                  </button>
                ))}
              </div>
              {numero !== null && Number.isFinite(numero) && (
                <span className="muted tabular">
                  {percent(distanceTo(precioActual, numero))}{" "}
                  {numero < precioActual ? "por debajo" : "por encima"} del precio actual
                </span>
              )}
            </div>
          )}
          {precioActual === null && (
            <p className="muted" style={{ margin: "0.5rem 0 0" }}>
              Sin precio todavía: escribe el valor a mano.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

/** El número que representa el campo, o null si está vacío o no es un número.
 *  `Number("")` es 0, y proponer "0 % por debajo" con el campo en blanco confunde. */
export function numeroDe(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Valor inicial al marcar la casilla: un 10 % de margen sobre el precio actual.
 *  Sin precio se deja en blanco, que es más honesto que proponer un 0. */
export function sugerencia(precio: number | null, signo: number): string {
  if (precio === null) return "";
  return String(redondear(precio * (1 + (signo * 10) / 100)));
}

/** Redondea a una cifra "humana": nadie quiere un umbral en 57 070,80. */
function redondear(value: number): number {
  const magnitud = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(value))) - 2));
  return Math.abs(value) >= 1 ? Math.round(value / magnitud) * magnitud : Number(value.toPrecision(4));
}
