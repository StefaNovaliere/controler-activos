"use client";

import { useState } from "react";
import { searchCatalog, type CatalogItem } from "@/lib/catalog";

/** Buscador del catálogo: el usuario escribe «oro», no `xauusd`. */
export function CatalogCombobox({ onPick }: { onPick: (item: CatalogItem) => void }) {
  const [query, setQuery] = useState("");
  const resultados = searchCatalog(query);

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
        {resultados.length === 0 && (
          <li className="muted">
            No está en el catálogo. Añádelo con «Configuración avanzada» indicando proveedor y
            símbolo, y pulsa «Comprobar» para confirmar que existe.
          </li>
        )}
      </ul>
    </div>
  );
}
