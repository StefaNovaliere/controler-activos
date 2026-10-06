"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { anotarAction, revisarAction } from "@/app/actions/diario";
import {
  DECISIONES,
  ENTRADAS_MINIMAS,
  MOTIVO_MAXIMO,
  NOTA_MAXIMA,
  PLANES,
  pareceMonto,
  type Decision,
  type Entrada,
  type Estadisticas,
  type Juicio,
  type Resultado,
  type SiguioPlan,
} from "@/lib/diario";
import { percent } from "@/lib/format";

const DECISION: Record<Decision, string> = {
  comprar: "Comprar",
  vender: "Vender",
  mantener: "Mantener",
  "no-hacer-nada": "No hacer nada",
};
const PLAN: Record<SiguioPlan, string> = { si: "Sí", no: "No", "sin-plan": "No había plan" };
const JUICIO: Record<Juicio, string> = { buena: "Buena", mala: "Mala", dudosa: "Dudosa" };

type Activo = { id: string; label: string };

type Props = {
  entradas: Entrada[];
  resultados: Record<string, Resultado>;
  stats: Estadisticas;
  activos: Activo[];
  prefill: { activo: string | null; aviso: string | null };
};

export function Diario({ entradas, resultados, stats, activos, prefill }: Props) {
  const nombre = (id: string) => activos.find((a) => a.id === id)?.label ?? id;

  return (
    <>
      <NuevaEntrada activos={activos} prefill={prefill} />
      <Resumen stats={stats} />

      <h2 style={{ margin: "1.5rem 0 0.6rem" }}>Entradas</h2>
      {entradas.length === 0 ? (
        <p className="muted">
          Todavía no hay ninguna. La próxima vez que llegue un aviso, anotá qué harías y por qué —
          aunque no hagas nada. «No hacer nada» también es una decisión, y suele ser la que más
          se repite.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.8rem" }}>
          {entradas.map((e) => (
            <li key={e.id}>
              <Tarjeta entrada={e} resultado={resultados[e.id]} nombre={nombre(e.activo)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ── Nueva entrada ────────────────────────────────────────────────────────────

const CLAVE_NOMBRE = "centinela:quien";

function NuevaEntrada({ activos, prefill }: { activos: Activo[]; prefill: Props["prefill"] }) {
  const router = useRouter();
  const [pendiente, empezar] = useTransition();
  const [quien, setQuien] = useState("");
  const [activo, setActivo] = useState(prefill.activo ?? activos[0]?.id ?? "");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [plan, setPlan] = useState<SiguioPlan | null>(null);
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState<string[]>([]);
  const [hecho, setHecho] = useState(false);

  // En un efecto: en el servidor no hay localStorage.
  useEffect(() => {
    try {
      setQuien(localStorage.getItem(CLAVE_NOMBRE) ?? "");
    } catch {
      /* ventana privada: se pide cada vez */
    }
  }, []);

  function enviar() {
    setErrores([]);
    setHecho(false);
    if (!decision || !plan) {
      setErrores(["Elige qué decidiste y si seguiste tu plan."]);
      return;
    }
    try {
      localStorage.setItem(CLAVE_NOMBRE, quien.trim());
    } catch {
      /* sin memoria, pero se anota igual */
    }
    empezar(async () => {
      const r = await anotarAction({
        quien,
        activo,
        decision,
        siguioPlan: plan,
        motivo,
        origen: prefill.aviso ? "aviso" : "propia",
        ...(prefill.aviso ? { aviso: prefill.aviso } : {}),
      });
      if (!r.ok) {
        setErrores(r.errores);
        return;
      }
      setMotivo("");
      setDecision(null);
      setPlan(null);
      setHecho(true);
      router.refresh();
    });
  }

  return (
    <section className="card card-ancho" style={{ marginBottom: "1.2rem" }}>
      <h2 style={{ marginTop: 0 }}>Anotar una decisión</h2>
      {prefill.aviso && (
        <p className="muted" style={{ marginTop: 0 }}>
          Viene de un aviso del centinela. Anotala ahora, antes de ver qué pasa después: es lo que
          hace que el diario mida tu decisión y no tu suerte.
        </p>
      )}

      <div className="row">
        <div className="grow">
          <label htmlFor="quien">Quién</label>
          <input id="quien" value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="tu nombre" maxLength={40} />
        </div>
        <div className="grow">
          <label htmlFor="activo">Activo</label>
          <select id="activo" value={activo} onChange={(e) => setActivo(e.target.value)}>
            {activos.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Eleccion
        titulo="Qué decidiste"
        opciones={DECISIONES}
        etiquetas={DECISION}
        valor={decision}
        onChange={setDecision}
      />
      <Eleccion
        titulo="¿Seguiste tu plan?"
        opciones={PLANES}
        etiquetas={PLAN}
        valor={plan}
        onChange={setPlan}
      />

      <label htmlFor="motivo" style={{ display: "block", marginTop: "0.8rem" }}>
        Por qué, en una frase
      </label>
      <textarea
        id="motivo"
        rows={3}
        maxLength={MOTIVO_MAXIMO}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="rompió el umbral con volumen alto y la revisión del token salió limpia"
        style={{ width: "100%" }}
      />
      {pareceMonto(motivo) ? (
        <p className="aviso aviso-ambar" style={{ margin: "0.4rem 0 0" }}>
          Parece que escribiste un monto. <strong>El diario es público</strong> (vive en el
          repositorio): mejor describí qué hizo el precio, no cuánto pusiste.
        </p>
      ) : (
        <p className="muted" style={{ margin: "0.3rem 0 0", fontSize: "0.85em" }}>
          Se guarda en el repositorio, que es público. Sin montos: qué y por qué, no cuánto.
        </p>
      )}

      {errores.length > 0 && (
        <ul className="aviso aviso-error" style={{ margin: "0.6rem 0 0", paddingLeft: "1.4rem" }}>
          {errores.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {hecho && (
        <p className="aviso aviso-ok" style={{ margin: "0.6rem 0 0" }}>
          Anotada. Volvé en un día a revisarla.
        </p>
      )}

      <div style={{ marginTop: "0.8rem" }}>
        <button type="button" onClick={enviar} disabled={pendiente}>
          {pendiente ? "Guardando…" : "Anotar"}
        </button>
      </div>
    </section>
  );
}

function Eleccion<T extends string>({
  titulo,
  opciones,
  etiquetas,
  valor,
  onChange,
}: {
  titulo: string;
  opciones: readonly T[];
  etiquetas: Record<T, string>;
  valor: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ marginTop: "0.8rem" }} role="group" aria-label={titulo}>
      <span className="muted" style={{ display: "block", marginBottom: "0.3rem" }}>
        {titulo}
      </span>
      <div className="rangos" style={{ margin: 0 }}>
        {opciones.map((o) => (
          <button
            key={o}
            type="button"
            className={o === valor ? "rango activo" : "rango"}
            aria-pressed={o === valor}
            onClick={() => onChange(o)}
          >
            {etiquetas[o]}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Resumen ──────────────────────────────────────────────────────────────────

function tasa(t: { n: number; aciertos: number }): string {
  return t.n === 0 ? "—" : `${t.aciertos} de ${t.n}`;
}

function Resumen({ stats }: { stats: Estadisticas }) {
  const { cuadrante: c } = stats;
  const conCuadrante = c.buenaBien + c.buenaMal + c.malaBien + c.malaMal;

  return (
    <section className="card card-ancho">
      <h2 style={{ marginTop: 0 }}>Lo que dice hasta ahora</h2>

      {stats.faltan > 0 ? (
        <p className="aviso aviso-ambar" style={{ marginTop: 0 }}>
          {stats.total} entrada(s). <strong>Faltan {stats.faltan}</strong> para que esto signifique
          algo: con menos de {ENTRADAS_MINIMAS}, cualquier porcentaje es una anécdota con decimales.
          Por eso abajo hay cuentas y no porcentajes.
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          {stats.total} entradas, {stats.revisadas} revisadas.
        </p>
      )}

      <p style={{ margin: "0.4rem 0" }}>
        Aciertos de dirección a 24 h (comprar o vender) — <strong>siguiendo el plan:</strong>{" "}
        {tasa(stats.siguiendoPlan)} · <strong>improvisando:</strong> {tasa(stats.sinSeguirPlan)}
        {stats.faltan === 0 && stats.siguiendoPlan.n > 0 && stats.sinSeguirPlan.n > 0 && (
          <>
            {" "}
            ({percent((stats.siguiendoPlan.aciertos / stats.siguiendoPlan.n) * 100)} contra{" "}
            {percent((stats.sinSeguirPlan.aciertos / stats.sinSeguirPlan.n) * 100)})
          </>
        )}
      </p>

      <p className="muted" style={{ margin: "0.8rem 0 0.4rem" }}>
        Proceso contra resultado ({conCuadrante} revisada(s) con resultado medible):
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: "32rem" }}>
        <thead>
          <tr>
            <th />
            <th className="muted" style={{ textAlign: "left", fontWeight: 500 }}>Salió bien</th>
            <th className="muted" style={{ textAlign: "left", fontWeight: 500 }}>Salió mal</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="muted" style={{ textAlign: "left", fontWeight: 500 }}>Buena decisión</th>
            <td>{c.buenaBien}</td>
            <td title="Mala suerte: el precio de jugar bien en un juego con azar. No hay nada que corregir.">
              {c.buenaMal} <span className="muted">mala suerte</span>
            </td>
          </tr>
          <tr>
            <th className="muted" style={{ textAlign: "left", fontWeight: 500 }}>Mala decisión</th>
            <td title="Suerte, y la más peligrosa: enseña a repetir lo que no debería repetirse.">
              {c.malaBien} <span className="muted">suerte</span>
            </td>
            <td>{c.malaMal}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85em" }}>
        Las dos casillas cruzadas son las que enseñan. <strong>Suerte</strong> es la peligrosa:
        una mala decisión que salió bien te enseña a repetirla. <strong>Mala suerte</strong> es el
        precio de jugar bien en un juego con azar: ahí no hay nada que corregir.
      </p>
    </section>
  );
}

// ── Una entrada ──────────────────────────────────────────────────────────────

function fecha(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : iso;
}

function Tarjeta({ entrada: e, resultado: r, nombre }: { entrada: Entrada; resultado?: Resultado; nombre: string }) {
  return (
    <article className="card card-ancho" style={{ padding: "0.9rem 1rem" }}>
      <div className="card-head" style={{ marginBottom: "0.3rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem" }}>
          {nombre} · {DECISION[e.decision]}
        </h3>
        <span className="muted" style={{ fontSize: "0.8rem" }}>
          {fecha(e.creado)} · {e.quien}
          {e.origen === "aviso" && " · desde un aviso"}
        </span>
      </div>
      <p style={{ margin: "0.2rem 0" }}>{e.motivo}</p>
      <p className="muted" style={{ margin: "0.2rem 0", fontSize: "0.85em" }}>
        Plan: {PLAN[e.siguioPlan]}
      </p>

      {e.revision ? <Revisada entrada={e} resultado={r} /> : <Revisar entrada={e} resultado={r} />}
    </article>
  );
}

function Medido({ r }: { r?: Resultado }) {
  if (!r || r.estado === "sin-datos") return <span className="muted">sin precio en el historial para medirla</span>;
  if (r.estado === "pendiente") return <span className="muted">todavía no pasaron 24 h</span>;
  const signo = r.cambioPct >= 0 ? "+" : "−";
  return (
    <>
      a 24 h el precio hizo <strong>{signo}{percent(r.cambioPct)}</strong>
      {r.acerto !== null && <> — {r.acerto ? "acertó la dirección" : "no acertó la dirección"}</>}
    </>
  );
}

function Revisada({ entrada: e, resultado: r }: { entrada: Entrada; resultado?: Resultado }) {
  const rev = e.revision!;
  return (
    <p style={{ margin: "0.5rem 0 0", fontSize: "0.9em" }}>
      <strong>Decisión {JUICIO[rev.juicio].toLowerCase()}</strong>
      {rev.nota && <> — {rev.nota}</>}
      <br />
      <span className="muted">
        Resultado: <Medido r={r} />
      </span>
    </p>
  );
}

/**
 * La revisión pregunta SOLO si la decisión fue buena con lo que se sabía
 * entonces. El resultado no se enseña hasta después de juzgar: si se ve antes,
 * el juicio se contamina y el diario termina midiendo la suerte en vez del
 * proceso, que es exactamente el error que existe para evitar.
 */
function Revisar({ entrada: e, resultado: r }: { entrada: Entrada; resultado?: Resultado }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [juicio, setJuicio] = useState<Juicio | null>(null);
  const [nota, setNota] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, empezar] = useTransition();

  if (!abierta) {
    return (
      <div style={{ marginTop: "0.5rem" }}>
        <button type="button" onClick={() => setAbierta(true)}>
          Revisar
        </button>{" "}
        <span className="muted" style={{ fontSize: "0.85em" }}>
          {r?.estado === "pendiente"
            ? "Mejor después de 24 h."
            : "El resultado se ve después de revisarla."}
        </span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: "0.6rem" }}>
      <p className="muted" style={{ margin: "0 0 0.3rem" }}>
        Con lo que sabías <strong>en ese momento</strong> —no con lo que pasó después—, ¿fue una
        buena decisión?
      </p>
      <div className="rangos" style={{ margin: 0 }} role="group" aria-label="Juicio">
        {(["buena", "mala", "dudosa"] as const).map((j) => (
          <button
            key={j}
            type="button"
            className={j === juicio ? "rango activo" : "rango"}
            aria-pressed={j === juicio}
            onClick={() => setJuicio(j)}
          >
            {JUICIO[j]}
          </button>
        ))}
      </div>
      <input
        aria-label="Nota de la revisión"
        placeholder="qué cambiarías (opcional)"
        maxLength={NOTA_MAXIMA}
        value={nota}
        onChange={(ev) => setNota(ev.target.value)}
        style={{ width: "100%", marginTop: "0.5rem" }}
      />
      {error && (
        <p className="aviso aviso-error" style={{ margin: "0.4rem 0 0" }}>
          {error}
        </p>
      )}
      <div style={{ marginTop: "0.5rem" }}>
        <button
          type="button"
          disabled={!juicio || pendiente}
          onClick={() =>
            empezar(async () => {
              const res = await revisarAction(e.id, juicio!, nota);
              if (!res.ok) setError(res.errores.join(" "));
              else router.refresh();
            })
          }
        >
          {pendiente ? "Guardando…" : "Guardar juicio y ver el resultado"}
        </button>
      </div>
    </div>
  );
}
