"use client";

import { useEffect, useState } from "react";
import { calcular } from "@/lib/tamano";
import { money } from "@/lib/format";
import { numeroDe } from "./ThresholdField";
import type { AssetInput } from "@/lib/types";

/**
 * Cuánto poner en esta operación.
 *
 * Casi nadie se funde por entrar mal: se funden por entrar GRANDE. Esta cuenta
 * es aritmética de primaria y es probablemente lo más valioso del panel.
 *
 * EL CAPITAL NO SE GUARDA EN EL REPOSITORIO. El repositorio es público: cuánto
 * dinero tienes no puede acabar en un commit. Vive en el navegador de cada uno,
 * que además es lo correcto: tu capital no es el de tu amigo.
 */
const CLAVE_CAPITAL = "centinela:capital";
const CLAVE_RIESGO = "centinela:riesgo";

export function Tamano({ asset, precio }: { asset: AssetInput; precio: number | null }) {
  const [capital, setCapital] = useState("");
  const [riesgo, setRiesgo] = useState("2");
  const [listo, setListo] = useState(false);

  // Se lee en un efecto, no en el estado inicial: en el servidor no hay
  // localStorage y leerlo durante el render rompería la hidratación.
  useEffect(() => {
    try {
      setCapital(localStorage.getItem(CLAVE_CAPITAL) ?? "");
      setRiesgo(localStorage.getItem(CLAVE_RIESGO) ?? "2");
    } catch {
      // Ventana privada o cookies bloqueadas: se sigue sin recordar nada.
    }
    setListo(true);
  }, []);

  function guardar(clave: string, valor: string) {
    try {
      localStorage.setItem(clave, valor);
    } catch {
      /* sin memoria, pero la cuenta sigue funcionando */
    }
  }

  const entrada = numeroDe(asset.entry_price ?? null) ?? precio;
  const stopUmbral = numeroDe(asset.lower);
  const caida = numeroDe(asset.trailing?.drop_pct ?? null);
  const stopGiro = entrada !== null && caida !== null ? entrada * (1 - caida / 100) : null;
  // El stop es el que primero te saca: el más alto de los dos.
  const stop = [stopUmbral, stopGiro].filter((v): v is number => v !== null).sort((a, b) => b - a)[0] ?? null;

  const cuenta =
    entrada !== null && stop !== null
      ? calcular({
          capital: Number(capital),
          riesgoPct: Number(riesgo),
          precioEntrada: entrada,
          stop,
        })
      : null;

  if (!listo) return null;

  return (
    <fieldset style={{ marginTop: "0.85rem" }}>
      <legend>¿Cuánto pongo?</legend>

      <div className="row">
        <div className="grow">
          <label htmlFor="capital">Tu capital total</label>
          <input
            id="capital"
            type="text"
            inputMode="decimal"
            placeholder="1000"
            value={capital}
            onChange={(e) => {
              const v = e.target.value.replace(/,/g, ".");
              setCapital(v);
              guardar(CLAVE_CAPITAL, v);
            }}
          />
        </div>
        <div style={{ width: "8rem" }}>
          <label htmlFor="riesgo">Arriesgo por operación</label>
          <div className="row" style={{ alignItems: "center" }}>
            <input
              id="riesgo"
              type="text"
              inputMode="decimal"
              value={riesgo}
              onChange={(e) => {
                const v = e.target.value.replace(/,/g, ".");
                setRiesgo(v);
                guardar(CLAVE_RIESGO, v);
              }}
              style={{ width: "4rem", textAlign: "right" }}
            />
            <strong style={{ marginLeft: "0.4rem" }}>%</strong>
          </div>
        </div>
      </div>

      <p className="muted" style={{ margin: "0.4rem 0 0", fontSize: "0.85em" }}>
        Esto se queda en <strong>tu navegador</strong>, no se guarda en el repositorio: es público.
      </p>

      <Resultado
        cuenta={cuenta}
        entrada={entrada}
        stop={stop}
        divisa={asset.currency || "usd"}
        hayCapital={Number(capital) > 0}
      />
    </fieldset>
  );
}

function Resultado({
  cuenta,
  entrada,
  stop,
  divisa,
  hayCapital,
}: {
  cuenta: ReturnType<typeof calcular>;
  entrada: number | null;
  stop: number | null;
  divisa: string;
  hayCapital: boolean;
}) {
  if (!hayCapital) return null;

  if (entrada === null) {
    return (
      <p className="muted" style={{ marginTop: "0.6rem" }}>
        Falta saber a qué precio entrarías. Pon el <strong>precio de entrada</strong> en el plan de
        salida, o espera a que el centinela traiga un precio.
      </p>
    );
  }

  if (stop === null) {
    return (
      <p className="aviso aviso-ambar" style={{ marginTop: "0.6rem" }}>
        Sin stop no hay cuenta posible: si no sabes dónde admitirías estar equivocado, no hay forma
        de saber cuánto arriesgas. Pon el aviso de <strong>BAJA de</strong> o el de{" "}
        <strong>CAE desde su máximo</strong>, y eso hace de stop.
      </p>
    );
  }

  if (!cuenta) {
    return (
      <p className="aviso aviso-error" style={{ marginTop: "0.6rem" }}>
        El stop ({money(stop, divisa)}) tiene que estar por debajo de la entrada (
        {money(entrada, divisa)}).
      </p>
    );
  }

  return (
    <div className="explica" style={{ marginTop: "0.6rem" }}>
      <p style={{ margin: "0 0 0.4rem" }}>
        Pon como mucho <strong>{money(cuenta.posicion, divisa)}</strong> (
        {cuenta.cantidad >= 1000
          ? `${Math.round(cuenta.cantidad).toLocaleString("es-AR")} unidades`
          : `${cuenta.cantidad.toPrecision(4)} unidades`}
        ), el {Math.round(cuenta.pesoPct)} % de tu capital.
      </p>
      <p style={{ margin: 0 }}>
        Si el precio llega a {money(stop, divisa)} —un {cuenta.distanciaPct.toFixed(1).replace(".", ",")} %
        por debajo— pierdes <strong>{money(cuenta.riesgoDinero, divisa)}</strong>.
      </p>

      {cuenta.limitadoPorCapital && (
        <p className="aviso aviso-ambar" style={{ margin: "0.6rem 0 0" }}>
          Ojo: con ese stop tan ancho, la cuenta pedía más dinero del que tienes. El límite aquí es
          tu capital, no el riesgo que elegiste, así que estás arriesgando lo que dice arriba y no
          el porcentaje que pusiste.
        </p>
      )}

      <p className="muted" style={{ margin: "0.6rem 0 0", fontSize: "0.85em" }}>
        En una memecoin con poca liquidez el stop puede no ejecutarse al precio que ves: el hueco
        entre una operación y la siguiente es tuyo. Trata este número como el mejor caso.
      </p>
    </div>
  );
}
