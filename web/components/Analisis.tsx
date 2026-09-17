"use client";

import { useState } from "react";
import { analizarAction, type Analisis as Datos } from "@/app/actions/config";
import { money } from "@/lib/format";

/**
 * Cuánto se mueve esta moneda, y qué umbrales tienen sentido para ELLA.
 *
 * El problema real: «0,0010» y «0,0015» parecen casi lo mismo, pero son un 50 %
 * de diferencia. En una moneda eso es el ruido de una tarde y en otra es la
 * señal de vender. Sin saber cuánto se mueve normalmente, poner un umbral es
 * adivinar, y hay que irse al mercado a mirarlo a mano.
 *
 * El número que de verdad decide es «te habría avisado N veces»: se entiende sin
 * saber nada de volatilidad, mientras que una desviación típica no. Y sale de la
 * misma lógica que el bot, contrastada con su motor real en
 * schema/alert_cases.json, así que no promete avisos que luego no llegan.
 */
type Props = {
  id: string;
  proveedor: string;
  simbolo: string;
  divisa: string;
  lower: string | null;
  upper: string | null;
  onUsar: (lower: string, upper: string) => void;
};

export function Analisis({ proveedor, simbolo, divisa, lower, upper, onUsar }: Props) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  if (proveedor !== "coingecko") return null;

  async function analizar() {
    setCargando(true);
    setError(null);
    const resultado = await analizarAction(simbolo, divisa, lower, upper);
    if (resultado.ok) setDatos(resultado.analisis);
    else setError(resultado.error);
    setCargando(false);
  }

  return (
    <div style={{ marginTop: "0.85rem" }}>
      <button type="button" onClick={() => void analizar()} disabled={cargando || !simbolo.trim()}>
        {cargando ? "Mirando los últimos 7 días…" : "¿Cuánto se mueve? Sugerir umbrales"}
      </button>

      {error && (
        <p className="aviso aviso-error" style={{ marginTop: "0.6rem" }}>
          {error}
        </p>
      )}

      {datos && <Resultado datos={datos} onUsar={onUsar} />}
    </div>
  );
}

function pct(valor: number): string {
  return `${valor >= 0 ? "+" : "−"}${Math.abs(valor).toFixed(1)} %`;
}

function frecuencia(avisos: number, dias: number): string {
  if (avisos === 0) return "no te habría avisado ni una vez";
  if (avisos === 1) return "te habría avisado 1 vez";
  return `te habría avisado ${avisos} veces en ${Math.round(dias)} días`;
}

function Resultado({ datos, onUsar }: { datos: Datos; onUsar: (l: string, u: string) => void }) {
  const { sugerido, divisa } = datos;

  return (
    <div className="explica" style={{ marginTop: "0.6rem" }}>
      <p style={{ margin: "0 0 0.5rem" }}>
        En los últimos <strong>{Math.round(datos.dias)} días</strong> se movió entre{" "}
        <strong>{money(datos.minimo, divisa)}</strong> y <strong>{money(datos.maximo, divisa)}</strong>{" "}
        ({pct(datos.cambioVentana)} de principio a fin). Un día cualquiera se mueve un{" "}
        <strong>{datos.diaTipico.toFixed(1)} %</strong>; un día movido, un{" "}
        <strong>{datos.diaFuerte.toFixed(1)} %</strong>.
      </p>

      <p style={{ margin: "0 0 0.5rem" }}>
        Por eso te propongo avisarte si baja de <strong>{money(sugerido.lower, divisa)}</strong> o
        sube de <strong>{money(sugerido.upper, divisa)}</strong> — un salto del{" "}
        {sugerido.margenPct.toFixed(1)} %, de los que a esta moneda le pasan más o menos una vez por
        semana. Con esos umbrales, {frecuencia(datos.avisosSugeridos, datos.dias)}.
      </p>

      {datos.avisosActuales !== null && (
        <p style={{ margin: "0 0 0.5rem" }}>
          Con los umbrales que tienes puestos ahora,{" "}
          <strong>{frecuencia(datos.avisosActuales, datos.dias)}</strong>.
        </p>
      )}

      <button
        type="button"
        onClick={() => onUsar(String(sugerido.lower), String(sugerido.upper))}
        style={{ marginTop: "0.2rem" }}
      >
        Usar estos umbrales
      </button>

      <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85em" }}>
        Son siete días de historia: sirven para saber qué es mucho y qué es poco en esta moneda, no
        para predecir nada. Una cripto puede hacer mañana algo que no hizo en toda la semana.
      </p>
    </div>
  );
}
