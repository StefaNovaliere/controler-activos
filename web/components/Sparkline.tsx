"use client";

import { useRef, useState } from "react";
import { money } from "@/lib/format";
import { redondear } from "@/lib/mercado";
import type { PuntoHistorial } from "@/lib/historial";

/**
 * La forma del precio dentro de la baldosa, con los umbrales dibujados encima.
 *
 * El número dice dónde está; esto dice de dónde viene, y sobre todo dónde caen
 * tus umbrales respecto de ese recorrido. Un umbral que la línea no roza en toda
 * la semana se ve de un vistazo, y eso no se deduce leyendo dos cifras.
 *
 * Decisiones que no son de gusto:
 *
 * * La línea va en el tono APAGADO y el punto de ahora en el vivo. Una línea
 *   neón compitiendo con el precio grande convierte la baldosa en ruido: lo que
 *   manda es el número, esto es el contexto.
 * * El eje X es tiempo real, no un punto por muestra. Los puntos los pone el
 *   cron y GitHub se salta ejecuciones: repartirlos a distancias iguales pintaría
 *   un parón de seis horas como una línea recta de mercado tranquilo.
 * * Sin rejilla ni ejes. Es un sparkline: la escala la dan los números que ya
 *   están en la tarjeta.
 * * Los umbrales van PUNTEADOS. En una rejilla el punteado es ruido, pero aquí
 *   significa exactamente lo que el ojo espera: un límite, no un dato medido.
 * * El azul es el de abajo y el verde el de arriba, como en el resto del panel.
 *   No dependen solo del color: el de abajo siempre está debajo, y sus cifras
 *   están escritas en la tarjeta. Ese par tiene separación de sobra en
 *   deuteranopia pero justita en tritanopia, así que la posición no es un adorno.
 */
type Props = {
  puntos: PuntoHistorial[];
  lower: number | null;
  upper: number | null;
  /** Dónde está AHORA el aviso de giro. A diferencia de un umbral fijo no es un
   *  número que alguien tecleó: sale del máximo (o del mínimo) que el bot lleva
   *  siguiendo, así que se mueve solo. */
  giroBaja: number | null;
  giroSube: number | null;
  divisa: string;
  etiqueta: string;
};

const ANCHO = 260;
const ALTO = 56;
const MARGEN = 4; // sitio para el radio del punto, que si no se recorta

export function Sparkline({ puntos, lower, upper, giroBaja, giroSube, divisa, etiqueta }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [foco, setFoco] = useState<number | null>(null);

  // Con menos de dos puntos no hay forma que enseñar, y una línea de un solo
  // punto es una promesa vacía: mejor decir que todavía no hay historia.
  if (puntos.length < 2) {
    return (
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
        Sin historial todavía: se dibuja solo cuando el centinela lleve un par de ejecuciones.
      </p>
    );
  }

  const precios = puntos.map((p) => p.precio);
  const lineas = [lower, upper, giroBaja, giroSube].filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  const hayGiro = giroBaja !== null || giroSube !== null;
  const hayFijo = lower !== null || upper !== null;

  // La escala incluye los umbrales: si no, un umbral lejano quedaría fuera del
  // dibujo y la pregunta que este gráfico contesta —¿está cerca de cruzarlo?—
  // no se podría contestar.
  const min = Math.min(...precios, ...lineas);
  const max = Math.max(...precios, ...lineas);

  // Pero el PIE habla del precio, no del dibujo. Usando los de arriba decía
  // «0,26 a 0,39» con la línea casi plana, porque 0,26 era un umbral y no un
  // precio que el activo llegara a tocar: describía el eje y no el recorrido.
  const minPrecio = Math.min(...precios);
  const maxPrecio = Math.max(...precios);
  const rango = max - min || Math.abs(max) || 1;

  const t0 = puntos[0].t;
  const span = puntos[puntos.length - 1].t - t0 || 1;

  const x = (t: number) => MARGEN + ((t - t0) / span) * (ANCHO - 2 * MARGEN);
  const y = (precio: number) => MARGEN + (1 - (precio - min) / rango) * (ALTO - 2 * MARGEN);

  const d = puntos.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.precio).toFixed(1)}`).join(" ");
  const ultimo = puntos[puntos.length - 1];
  const activo = foco === null ? ultimo : puntos[foco];

  function alMover(event: React.PointerEvent<SVGSVGElement>) {
    const caja = svgRef.current?.getBoundingClientRect();
    if (!caja) return;
    const px = ((event.clientX - caja.left) / caja.width) * ANCHO;
    // El más cercano por posición real, no por índice: con huecos en la serie
    // no son lo mismo.
    let mejor = 0;
    for (let i = 1; i < puntos.length; i++) {
      if (Math.abs(x(puntos[i].t) - px) < Math.abs(x(puntos[mejor].t) - px)) mejor = i;
    }
    setFoco(mejor);
  }

  return (
    <figure style={{ margin: "0.5rem 0 0" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        width="100%"
        // Escalado uniforme a propósito. Con `preserveAspectRatio="none"` el
        // dibujo se estira a lo ancho de la tarjeta y el punto de «ahora» se
        // convierte en una elipse: aquí casi no se notaba porque la tarjeta mide
        // casi lo mismo que el viewBox, pero en una más ancha canta.
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${etiqueta}: ${puntos.length} precios entre ${money(minPrecio, divisa)} y ${money(maxPrecio, divisa)}. Ahora ${money(ultimo.precio, divisa)}.`}
        onPointerMove={alMover}
        onPointerLeave={() => setFoco(null)}
        style={{ display: "block", width: "100%", height: "auto", touchAction: "none", cursor: "crosshair" }}
      >
        {lower !== null && Number.isFinite(lower) && (
          <line
            x1={0} x2={ANCHO} y1={y(lower)} y2={y(lower)}
            stroke="var(--azul)" strokeWidth={1} strokeDasharray="3 3" opacity={0.75}
          />
        )}
        {upper !== null && Number.isFinite(upper) && (
          <line
            x1={0} x2={ANCHO} y1={y(upper)} y2={y(upper)}
            stroke="var(--verde)" strokeWidth={1} strokeDasharray="3 3" opacity={0.75}
          />
        )}

        {/* Los avisos de giro van PUNTEADOS finos y los fijos a rayas: son dos
            cosas distintas y comparten color por familia (abajo azul, arriba
            verde). El punteado dice «esto se mueve solo». */}
        {giroBaja !== null && Number.isFinite(giroBaja) && (
          <line
            x1={0} x2={ANCHO} y1={y(giroBaja)} y2={y(giroBaja)}
            stroke="var(--azul)" strokeWidth={1} strokeDasharray="1 3" opacity={0.9}
          />
        )}
        {giroSube !== null && Number.isFinite(giroSube) && (
          <line
            x1={0} x2={ANCHO} y1={y(giroSube)} y2={y(giroSube)}
            stroke="var(--verde)" strokeWidth={1} strokeDasharray="1 3" opacity={0.9}
          />
        )}

        <path d={d} fill="none" stroke="var(--apagado)" strokeWidth={1.5}
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

        {foco !== null && (
          <line x1={x(activo.t)} x2={x(activo.t)} y1={0} y2={ALTO}
                stroke="var(--borde-vivo)" strokeWidth={1} />
        )}

        {/* El punto de ahora en el tono vivo: es el dato que se está leyendo.
            El anillo del color de la superficie lo despega de la línea. */}
        <circle cx={x(activo.t)} cy={y(activo.precio)} r={4}
                fill="var(--texto)" stroke="var(--superficie)" strokeWidth={2} />
      </svg>

      {/* La leyenda solo aparece cuando conviven los dos tipos de línea, y solo
          nombra lo que está dibujado: anunciar un «umbral fijo» en una tarjeta
          que no tiene ninguno es ruido que hay que descifrar. */}
      {hayGiro && (
        <p className="muted" style={{ fontSize: "0.72rem", margin: "0.15rem 0 0" }}>
          {hayFijo && (
            <>
              <span style={{ color: "var(--azul)" }}>– –</span> umbral fijo ·{" "}
            </>
          )}
          <span style={{ color: "var(--azul)" }}>· · ·</span> aviso de giro
          {giroBaja !== null && <> en {money(redondear(giroBaja), divisa)}</>}
        </p>
      )}

      <figcaption className="muted" style={{ fontSize: "0.75rem", marginTop: "0.15rem" }}>
        {foco === null ? (
          // Redondeado: el pie da contexto, y «0,109072» promete una precisión
          // que no cambia ninguna decisión.
          <>
            {lapso(puntos)} · {money(redondear(minPrecio), divisa)} a{" "}
            {money(redondear(maxPrecio), divisa)}
          </>
        ) : (
          <>{money(activo.precio, divisa)} · {new Date(activo.t).toLocaleString("es-AR", {
            day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
          })}</>
        )}
      </figcaption>
    </figure>
  );
}

/** Cuánto tiempo abarca lo dibujado. Antes decía «últimos N registros», que era
 *  la unidad de dentro y no la que elige quien mira: con el selector de periodo
 *  lo que importa es el tiempo, no cuántas veces corrió el cron. */
function lapso(puntos: PuntoHistorial[]): string {
  const ms = puntos[puntos.length - 1].t - puntos[0].t;
  const horas = ms / 3_600_000;
  if (horas < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (horas < 48) return `${Math.round(horas)} h`;
  return `${Math.round(horas / 24)} días`;
}
