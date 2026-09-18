"use client";

import { useState } from "react";
import { revisarTokenAction, type RevisionToken } from "@/app/actions/config";

/**
 * ¿Este token está hecho para dejarte salir?
 *
 * Todo lo demás en la ficha habla del precio. Esto habla del token, que es otro
 * riesgo: el precio puede bajar —normal, para eso están los umbrales— o el
 * contrato puede impedirte vender, que no es riesgo de mercado y cuesta el
 * 100 % de golpe.
 *
 * No predice nada. Es la única parte del panel con ventaja sostenible, porque
 * no intenta adivinar el futuro: comprueba hechos del presente.
 */
const ICONO: Record<string, string> = { ok: "✓", aviso: "⚠", grave: "✕", desconocido: "?" };
const COLOR: Record<string, string> = {
  ok: "var(--verde)",
  aviso: "var(--ambar)",
  grave: "var(--rojo)",
  desconocido: "var(--apagado)",
};

export function Revision({ id, proveedor }: { id: string; proveedor: string }) {
  const [datos, setDatos] = useState<RevisionToken | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  if (proveedor !== "coingecko") return null;

  async function revisar() {
    setCargando(true);
    setError(null);
    const r = await revisarTokenAction(id);
    if (r.ok) setDatos(r.revision);
    else setError(r.error);
    setCargando(false);
  }

  return (
    <div style={{ marginTop: "0.85rem" }}>
      <button type="button" onClick={() => void revisar()} disabled={cargando || !id.trim()}>
        {cargando ? "Revisando el contrato…" : "Revisar el token"}
      </button>

      {error && (
        <p className="aviso aviso-ambar" style={{ marginTop: "0.6rem" }}>
          {error}
        </p>
      )}

      {datos && <Informe datos={datos} />}
    </div>
  );
}

function Titular({ datos }: { datos: RevisionToken }) {
  if (datos.graves > 0) {
    return (
      <p className="aviso aviso-error" style={{ margin: "0 0 0.6rem" }}>
        <strong>{datos.graves} problema(s) grave(s).</strong> Cualquiera de ellos puede costarte todo
        lo que pongas, no una parte.
      </p>
    );
  }
  if (datos.avisos > 0) {
    return (
      <p className="aviso aviso-ambar" style={{ margin: "0 0 0.6rem" }}>
        Sin problemas graves, pero <strong>{datos.avisos} cosa(s) que mirar</strong> antes de poner
        dinero.
      </p>
    );
  }
  // Sin las comprobaciones del contrato, «ninguna señal de trampa» sería una
  // afirmación sin respaldo: justo las que faltan son las que detectan la
  // trampa. El titular tiene que decir lo que de verdad se comprobó.
  if (datos.desconocidos > datos.puntos.length / 2) {
    return (
      <p className="aviso aviso-ambar" style={{ margin: "0 0 0.6rem" }}>
        <strong>Revisión incompleta.</strong> Se comprobó poco más que la liquidez y la antigüedad:
        las comprobaciones que detectan una trampa son justo las que faltan, así que esto{" "}
        <strong>no</strong> es un visto bueno.
      </p>
    );
  }

  return (
    <p className="explica" style={{ margin: "0 0 0.6rem" }}>
      Ninguna señal conocida de trampa. <strong>Esto no dice que vaya a subir</strong>: dice que si
      sube, vas a poder vender.
    </p>
  );
}

function Informe({ datos }: { datos: RevisionToken }) {
  return (
    <div style={{ marginTop: "0.6rem" }}>
      <Titular datos={datos} />

      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {datos.puntos.map((p) => (
          <li key={p.clave} style={{ display: "flex", gap: "0.5rem", padding: "0.2rem 0" }}>
            <span style={{ color: COLOR[p.estado], fontWeight: 700, width: "1rem" }} aria-hidden>
              {ICONO[p.estado]}
            </span>
            <span>
              {/* El estado va también en palabras: el color solo no vale para
                  quien no lo distingue, y aquí equivocarse cuesta dinero. */}
              <strong>{p.titulo}</strong>{" "}
              <span className="muted">
                ({etiqueta(p.estado)}) — {p.detalle}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {datos.desconocidos > 0 && (
        <p className="aviso aviso-ambar" style={{ margin: "0.6rem 0 0" }}>
          <strong>{datos.desconocidos} punto(s) sin comprobar.</strong>{" "}
          {datos.nota ?? "El proveedor no devolvió esos datos."}{" "}
          Un dato que falta <strong>no es un aprobado</strong>: trátalo como si no se supiera.
        </p>
      )}

      {datos.direccion && (
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85em" }}>
          Contrato {datos.direccion.length > 16
            ? `${datos.direccion.slice(0, 8)}…${datos.direccion.slice(-6)}`
            : datos.direccion}
          {datos.plataforma && <> en <strong>{datos.plataforma}</strong></>}.
        </p>
      )}

      {(datos.twitter || datos.web) && (
        <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85em" }}>
          Enlaces oficiales según CoinGecko:{" "}
          {datos.web && (
            <a href={datos.web} target="_blank" rel="noopener noreferrer nofollow">
              web
            </a>
          )}
          {datos.web && datos.twitter && " · "}
          {datos.twitter && (
            <a href={datos.twitter} target="_blank" rel="noopener noreferrer nofollow">
              Twitter
            </a>
          )}
          . Son del proyecto: marketing, no análisis.
        </p>
      )}

      <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85em" }}>
        Detecta patrones técnicos conocidos, no intenciones. Un token puede pasar las once
        revisiones y bajar igual, o el equipo puede vaciar el proyecto de formas que ningún análisis
        automático ve.
      </p>
    </div>
  );
}

function etiqueta(estado: string): string {
  return { ok: "bien", aviso: "atención", grave: "grave", desconocido: "sin comprobar" }[estado] ?? estado;
}
