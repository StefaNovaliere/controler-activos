"use client";

import { useState } from "react";
import { searchCatalog, type CatalogItem } from "@/lib/catalog";

type Props = {
  onPick: (item: CatalogItem) => void;
  /** Para lo que no está en el catálogo: se crea con el nombre tecleado y se
   *  abre para que el usuario indique proveedor y símbolo. Sin esto, el mensaje
   *  de "no está en el catálogo" era un callejón sin salida: mandaba a la
   *  configuración avanzada, que vive dentro de una ficha que aún no existe. */
  onManual: (nombre: string) => void;
};

export function CatalogCombobox({ onPick, onManual }: Props) {
  const [query, setQuery] = useState("");
  const resultados = searchCatalog(query);
  const escrito = query.trim();

  return (
    <div>
      <label htmlFor="buscar">¿Qué quieres vigilar?</label>
      <input
        id="buscar"
        type="text"
        placeholder="oro, bitcoin, apple, euro…"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />

      <ul style={{ listStyle: "none", padding: 0, margin: "0.6rem 0 0" }}>
        {resultados.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              style={{ width: "100%", textAlign: "left", marginBottom: "0.3rem" }}
              onClick={() => onPick(item)}
            >
              <strong>{item.name}</strong>{" "}
              <span className="muted">
                {item.kind} · {item.primary.provider}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {escrito && (
        <div style={{ marginTop: resultados.length ? "0.6rem" : 0 }}>
          {resultados.length === 0 && (
            // "No está en el catálogo" se leía como "no existe". El catálogo es
            // una lista local de atajos, no una búsqueda en el proveedor: no
            // saber nada de un activo no dice nada sobre si el proveedor lo tiene.
            <p className="muted" style={{ margin: "0 0 0.5rem" }}>
              No está en la lista de atajos, que son solo los activos más habituales. Eso{" "}
              <strong>no</strong> significa que el proveedor no lo tenga: añádelo indicando su
              símbolo y pulsa <strong>Comprobar</strong>, que pide el precio de verdad y te dice en
              el acto si existe.
            </p>
          )}
          <button type="button" onClick={() => onManual(escrito)}>
            Añadir «{escrito}» a mano
          </button>
        </div>
      )}
    </div>
  );
}
