"use client";

import { useState } from "react";
import { analizarAction, type Analisis as Datos } from "@/app/actions/config";
import { money, percent } from "@/lib/format";

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
  onUsarGiro: (caidaPct: string) => void;
};

export function Analisis({ proveedor, simbolo, divisa, lower, upper, onUsar, onUsarGiro }: Props) {
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

      {datos && <Resultado datos={datos} onUsar={onUsar} onUsarGiro={onUsarGiro} />}
    </div>
  );
}

/** Con signo y con coma decimal, como el resto del panel. `toFixed` escribe
 *  «163.4» con punto, que en castellano se lee como si fueran 1634. */
function conSigno(valor: number): string {
  return `${valor >= 0 ? "+" : "−"}${percent(valor)}`;
}

function dias(n: number): string {
  const redondeado = Math.max(1, Math.round(n));
  return redondeado === 1 ? "1 día" : `${redondeado} días`;
}

function frecuencia(avisos: number, ventana: number): string {
  if (avisos === 0) return `no te habría avisado ni una vez en ${dias(ventana)}`;
  if (avisos === 1) return `te habría avisado 1 vez en ${dias(ventana)}`;
  return `te habría avisado ${avisos} veces en ${dias(ventana)}`;
}

/**
 * ¿Se está moviendo más que de costumbre?
 *
 * Que las ventanas discrepen no es un fallo del cálculo: es EL hallazgo. Un
 * activo que esta semana se mueve el triple que en los últimos tres meses no es
 * el mismo activo para el que se calibró el umbral, y eso es exactamente lo que
 * decide si hay que rehacerlo.
 */
function Regimen({ valor, base }: { valor: number | null; base: number }) {
  if (valor === null) return null;

  if (valor >= 1.5) {
    return (
      <p className="aviso aviso-ambar" style={{ margin: "0 0 0.5rem" }}>
        Esta semana se está moviendo <strong>{valor.toFixed(1).replace(".", ",")} veces</strong> más
        que su costumbre de {base} días. Los umbrales calculados sobre el periodo largo se te van a
        quedar estrechos mientras dure.
      </p>
    );
  }

  if (valor <= 0.6) {
    return (
      <p className="muted" style={{ margin: "0 0 0.5rem" }}>
        Está más tranquila que de costumbre: se mueve la{" "}
        {valor.toFixed(1).replace(".", ",")} parte de lo que se movió en {base} días. Un umbral
        calculado sobre el periodo largo puede quedarte ancho y no sonar nunca.
      </p>
    );
  }
  return null;
}

function Resultado({
  datos,
  onUsar,
  onUsarGiro,
}: {
  datos: Datos;
  onUsar: (l: string, u: string) => void;
  onUsarGiro: (caidaPct: string) => void;
}) {
  const { sugerido, divisa } = datos;
  // Una moneda recién listada no tiene 7 días de historia. Con menos de tres, o
  // con pocas ventanas de 24 h medidas, los percentiles son casi anécdota: hay
  // que decirlo, no presentarlos como si fueran sólidos.
  const flojo = datos.dias < 3 || datos.muestras < 12;

  return (
    <div className="explica" style={{ marginTop: "0.6rem" }}>
      <p style={{ margin: "0 0 0.5rem" }}>
        En {dias(datos.dias)} se movió entre <strong>{money(datos.minimo, divisa)}</strong> y{" "}
        <strong>{money(datos.maximo, divisa)}</strong> ({conSigno(datos.cambioVentana)} de principio
        a fin). Un día cualquiera se mueve un <strong>{percent(datos.diaTipico)}</strong>; un día
        movido, un <strong>{percent(datos.diaFuerte)}</strong>.
      </p>

      {datos.ventanas.length > 1 && (
        <p className="muted" style={{ margin: "0 0 0.5rem", fontSize: "0.9em" }}>
          Día movido según el periodo que se mire:{" "}
          {datos.ventanas.map((v, i) => (
            <span key={v.dias}>
              {i > 0 && " · "}
              {v.dias} d: <strong>{percent(v.diaFuerte)}</strong>
            </span>
          ))}
          . La propuesta sale del periodo más largo, que es el que tiene muestra para sostenerla.
        </p>
      )}

      <Regimen valor={datos.regimen} base={datos.dias} />

      <p style={{ margin: "0 0 0.5rem" }}>
        Por eso te propongo avisarte si sube de <strong>{money(sugerido.upper, divisa)}</strong>{" "}
        (+{percent(sugerido.margenPct)}) o si baja de{" "}
        <strong>{money(sugerido.lower, divisa)}</strong> (−{percent(sugerido.caidaPct)}). Son los
        dos movimientos igual de raros: subir multiplica el precio y bajar lo divide, por eso las
        cifras no coinciden. Más grandes que los de 9 de cada 10 días medidos.
      </p>

      <p style={{ margin: "0 0 0.5rem" }}>
        Con esos umbrales, <strong>{frecuencia(datos.avisosSugeridos, datos.dias)}</strong>.
        {datos.avisosActuales !== null && (
          <> Con los que tienes puestos ahora, {frecuencia(datos.avisosActuales, datos.dias)}.</>
        )}
      </p>

      <button
        type="button"
        onClick={() => onUsar(String(sugerido.lower), String(sugerido.upper))}
        style={{ marginTop: "0.2rem" }}
      >
        Usar estos umbrales
      </button>

      <p style={{ margin: "0.9rem 0 0.5rem" }}>
        Y si lo que quieres es <strong>vender alto sin adivinar el techo</strong>, para esta moneda
        pondría el aviso de giro en <strong>{percent(datos.giroPct)}</strong> de caída desde su
        máximo: por encima de un día movido, así no salta con el vaivén normal. Con ese,{" "}
        {frecuencia(datos.avisosGiro, datos.dias)} — y a diferencia de un umbral fijo, no hay que
        volver a tocarlo aunque la moneda se multiplique.
      </p>

      <button type="button" onClick={() => onUsarGiro(String(datos.giroPct))}>
        Usar este aviso de giro
      </button>

      {flojo ? (
        <p className="aviso aviso-ambar" style={{ margin: "0.6rem 0 0" }}>
          Ojo: solo hay <strong>{dias(datos.dias)}</strong> de historia
          {datos.muestras < 12 && <> y {datos.muestras} medición(es) de 24 h</>}. Es una moneda
          demasiado nueva para saber qué es normal en ella: tómate esto como una primera
          aproximación y revísalo dentro de unos días.
        </p>
      ) : (
        <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85em" }}>
          Son {dias(datos.dias)} de historia: sirven para saber qué es mucho y qué es poco en esta
          moneda, no para predecir nada. Una cripto puede hacer mañana algo que no hizo en toda la
          semana.
        </p>
      )}
    </div>
  );
}
