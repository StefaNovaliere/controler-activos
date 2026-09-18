"use client";

import { useEffect, useState } from "react";
import { ago, minutesSince } from "@/lib/format";

/** La antigüedad se calcula en el cliente: Vercel corre en UTC y formatear en el
 *  servidor daría una hora ajena al usuario y desajuste de hidratación. */
export function Freshness({ updatedAt }: { updatedAt: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (now === null) return <p className="sub">Cargando estado…</p>;

  if (!updatedAt) {
    return (
      <p className="aviso aviso-ambar">
        El centinela no se ha ejecutado <strong>nunca</strong>. Comprueba que el bloque{" "}
        <code>schedule</code> de <code>.github/workflows/watch.yml</code> está descomentado.
      </p>
    );
  }

  const minutes = minutesSince(updatedAt, now);
  // El cron es de 15 min y GitHub lo retrasa bajo carga: por debajo de ~40 min
  // no hay nada que reportar. Antes eran 70, cuando el cron era de media hora.
  const parado = minutes !== null && minutes > 40;

  return parado ? (
    <p className="aviso aviso-ambar">
      El centinela no se ejecuta desde {ago(updatedAt, now)}. ¿Está activo el cron?
    </p>
  ) : (
    <p className="sub">Datos actualizados {ago(updatedAt, now)}.</p>
  );
}
