"use client";

import { normalizar } from "./ThresholdField";
import type { AssetInput } from "@/lib/types";

/**
 * Avisos de giro: «cae un X % desde su máximo», «rebota un X % desde su mínimo».
 *
 * Un umbral fijo contesta «¿llegó a este precio?» y sirve cuando tienes una
 * opinión de precio. Esto contesta «¿se dio la vuelta?», que es la pregunta de
 * vender alto y comprar barato: no hay que acertar el techo, solo decidir
 * cuánto estás dispuesto a devolver desde él.
 *
 * Y a diferencia de un umbral fijo, no hay que reajustarlo: un porcentaje sobre
 * el propio máximo vale igual a 0,07 que a 7.
 */
type Props = {
  asset: AssetInput;
  onChange: (trailing: AssetInput["trailing"]) => void;
};

export function Giro({ asset, onChange }: Props) {
  const caida = asset.trailing?.drop_pct ?? null;
  const subida = asset.trailing?.rise_pct ?? null;

  // `null` es "desactivado", `""` es "activado pero vacío": borrar el último
  // dígito no puede plegar el campo, que es un paso normal al escribir.
  const set = (campo: "drop_pct" | "rise_pct", valor: string | null) => {
    const siguiente = { drop_pct: caida, rise_pct: subida, [campo]: valor };
    onChange(siguiente.drop_pct === null && siguiente.rise_pct === null ? null : siguiente);
  };

  return (
    <fieldset style={{ marginTop: "0.85rem" }}>
      <legend>Avisos de giro</legend>
      <p className="muted" style={{ margin: "0 0 0.6rem" }}>
        Los umbrales de arriba te avisan al llegar a un precio. Estos te avisan cuando{" "}
        <strong>cambia de dirección</strong>, sea cual sea el precio: no hace falta acertar el techo
        ni volver a tocarlos cuando el activo sube de escala.
      </p>

      <Campo
        titulo="Avísame si CAE desde su máximo"
        ayuda="Para vender alto sin adivinar el techo: puede subir lo que quiera, y te avisa el día que devuelve este porcentaje desde donde llegó."
        valor={caida}
        porDefecto="20"
        onChange={(v) => set("drop_pct", v)}
      />

      <Campo
        titulo="Avísame si REBOTA desde su mínimo"
        ayuda="Para comprar barato sin agarrar un cuchillo cayendo: espera a que el precio se dé la vuelta en vez de avisarte durante la caída."
        valor={subida}
        porDefecto="30"
        onChange={(v) => set("rise_pct", v)}
      />
    </fieldset>
  );
}

function Campo({
  titulo,
  ayuda,
  valor,
  porDefecto,
  onChange,
}: {
  titulo: string;
  ayuda: string;
  valor: string | null;
  porDefecto: string;
  onChange: (valor: string | null) => void;
}) {
  const activo = valor !== null;

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <label style={{ display: "inline-flex", gap: "0.45rem", alignItems: "center", margin: 0 }}>
        <input
          type="checkbox"
          checked={activo}
          onChange={(event) => onChange(event.target.checked ? porDefecto : null)}
        />
        {titulo}
      </label>

      {activo && (
        <>
          <div className="row" style={{ marginTop: "0.4rem" }}>
            <input
              className="grow"
              type="text"
              inputMode="decimal"
              aria-label={titulo}
              value={valor}
              onChange={(event) => onChange(normalizar(event.target.value))}
            />
            <span className="muted">%</span>
          </div>
          <p className="muted" style={{ margin: "0.3rem 0 0", fontSize: "0.85em" }}>
            {ayuda}
          </p>
        </>
      )}
    </div>
  );
}
