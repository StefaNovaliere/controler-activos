"use client";

import { useState, useTransition } from "react";
import { guardarAction, type SaveResult } from "@/app/actions/config";
import { crossChecks } from "@/lib/crossChecks";
import type { CatalogItem } from "@/lib/catalog";
import type { AssetInput, AssetState } from "@/lib/types";
import { AssetCard } from "./AssetCard";
import { CatalogCombobox } from "./CatalogCombobox";

type Props = {
  inicial: AssetInput[];
  estados: Record<string, AssetState>;
  providers: string[];
};

export function Panel({ inicial, estados, providers }: Props) {
  const [assets, setAssets] = useState<AssetInput[]>(inicial);
  const [anadiendo, setAnadiendo] = useState(false);
  // Uno abierto a la vez: en una cuadrícula, dos editores desplegados a la vez
  // descolocan las filas y obligan a buscar dónde estaba cada activo.
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const [resultado, setResultado] = useState<SaveResult | null>(null);
  const [guardando, startTransition] = useTransition();

  const sucio = JSON.stringify(assets) !== JSON.stringify(inicial);
  const errores = crossChecks(assets, providers);

  function reemplazar(indice: number, asset: AssetInput) {
    setAssets(assets.map((a, i) => (i === indice ? asset : a)));
    setResultado(null);
  }

  function anadirDelCatalogo(item: CatalogItem) {
    const id = idLibre(item.suggested_id, assets);
    setAssets([
      ...assets,
      {
        id,
        label: item.name,
        provider: item.primary.provider,
        symbol: item.primary.symbol,
        currency: item.currencies[0] ?? "usd",
        lower: null,
        upper: null,
        enabled: true,
        // El catálogo trae el respaldo y los ajustes que nadie configuraría a
        // mano pero que evitan falsos avisos (una acción sin 4 días de tolerancia
        // da un fallo fantasma cada lunes).
        fallback: item.fallback ?? null,
        max_staleness_minutes: numero(item.overrides?.max_staleness_minutes),
        hysteresis_pct: texto(item.overrides?.hysteresis_pct),
      },
    ]);
    setAnadiendo(false);
    setAbiertoId(id);
    setResultado(null);
  }

  /** Un activo que no está en el catálogo: nombre puesto, resto por rellenar.
   *  Se abre directo, y las comprobaciones del formulario no dejarán guardarlo
   *  hasta que tenga símbolo y al menos un umbral. */
  function anadirAMano(nombre: string) {
    const id = idLibre(slug(nombre), assets);
    setAssets([
      ...assets,
      {
        id,
        label: nombre,
        provider: providers[0] ?? "coingecko",
        symbol: "",
        currency: "usd",
        lower: null,
        upper: null,
        enabled: true,
      },
    ]);
    setAnadiendo(false);
    setAbiertoId(id);
    setResultado(null);
  }

  function guardar() {
    setResultado(null);
    startTransition(async () => setResultado(await guardarAction(assets)));
  }

  return (
    <>
      {resultado && <Resultado resultado={resultado} />}

      <div className="grid">
        {assets.map((asset, indice) => (
          <AssetCard
            key={`${asset.id}-${indice}`}
            asset={asset}
            estado={estados[asset.id]}
            abierto={asset.id === abiertoId}
            onToggle={() => setAbiertoId(asset.id === abiertoId ? null : asset.id)}
            onChange={(cambiado) => reemplazar(indice, cambiado)}
            onDelete={() => {
              setAssets(assets.filter((_, i) => i !== indice));
              setAbiertoId(null);
              setResultado(null);
            }}
          />
        ))}
      </div>

      {anadiendo ? (
        <div className="card">
          <CatalogCombobox onPick={anadirDelCatalogo} onManual={anadirAMano} />
          <button type="button" className="link" onClick={() => setAnadiendo(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAnadiendo(true)}>
          + Añadir activo
        </button>
      )}

      {errores.length > 0 && (
        <div className="aviso aviso-error">
          <ul>
            {errores.map((error, index) => (
              <li key={index}>
                {error.assetId && <strong>{etiqueta(assets, error.assetId)}: </strong>}
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky">
        <button className="primary" onClick={guardar} disabled={!sucio || guardando || errores.length > 0}>
          {guardando ? "Guardando…" : "Guardar cambios"}
        </button>
        {errores.length > 0 ? (
          <span className="muted">
            {errores.length === 1 ? "Hay 1 problema que corregir" : `Hay ${errores.length} problemas que corregir`}
          </span>
        ) : sucio ? (
          <span className="muted">Cambios sin guardar</span>
        ) : (
          <span className="muted">Todo guardado</span>
        )}
        {sucio && (
          <button type="button" className="link" onClick={() => { setAssets(inicial); setResultado(null); }}>
            Descartar
          </button>
        )}
      </div>

    </>
  );
}

function Resultado({ resultado }: { resultado: SaveResult }) {
  switch (resultado.status) {
    case "ok":
      return (
        <div className="aviso aviso-ok aviso-compacto">
          Guardado. Se aplicará en la próxima comprobación.{" "}
          <a href={resultado.htmlUrl} target="_blank" rel="noreferrer">
            Ver el cambio
          </a>
          {resultado.reevaluados.length > 0 && (
            <>
              <br />
              Cambiaste los umbrales de <strong>{resultado.reevaluados.join(", ")}</strong>: puede
              que te avise en la próxima comprobación si ya están fuera de rango.
            </>
          )}
          {/* El detalle técnico se pliega: a quien solo viene a poner umbrales no
              le dice nada, y ocupaba más que el propio "Guardado". */}
          {resultado.degradado && (
            <details className="opciones">
              <summary>Se guardó sin la comprobación completa</summary>
              <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                Las comprobaciones del formulario sí se hicieron, y si algo se les escapara saldría
                como CI en rojo en GitHub. Causa: {resultado.degradado}
              </p>
            </details>
          )}
        </div>
      );
    case "invalid":
      return (
        <div className="aviso aviso-error">
          No se ha guardado nada. El centinela no aceptaría esta configuración:
          <ul>
            {resultado.errors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      );
    case "stale":
      return (
        <div className="aviso aviso-ambar">
          Alguien guardó cambios mientras editabas (quizá tú en otra pestaña). Tus cambios{" "}
          <strong>no se han perdido</strong>, pero tampoco se han guardado: recarga la página y
          vuelve a aplicarlos para no pisar lo que hizo la otra persona.
        </div>
      );
    case "busy":
      return (
        <div className="aviso aviso-ambar">
          El repositorio estaba ocupado. Vuelve a intentarlo en unos segundos.
        </div>
      );
    default:
      return <div className="aviso aviso-error">Error: {resultado.message}</div>;
  }
}

/** Un identificador válido a partir de un nombre cualquiera: el patrón del
 *  esquema solo admite letras, números, punto, guion y guion bajo. */
function slug(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return limpio || "activo";
}

/** El nombre que el usuario ve, no el identificador interno. */
function etiqueta(assets: AssetInput[], id: string): string {
  return assets.find((a) => a.id === id)?.label || id;
}

function idLibre(base: string, assets: AssetInput[]): string {
  const usados = new Set(assets.map((a) => a.id));
  if (!usados.has(base)) return base;
  for (let n = 2; n < 99; n++) if (!usados.has(`${base}${n}`)) return `${base}${n}`;
  return `${base}-${Date.now()}`;
}

const numero = (value: unknown) => (typeof value === "number" ? value : null);
const texto = (value: unknown) => (value === undefined || value === null ? null : String(value));
