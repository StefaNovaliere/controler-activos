import Link from "next/link";
import { requireSession } from "@/lib/dal";
import { cargarAssets } from "@/app/actions/config";
import { readRaw, DIARIO_PATH } from "@/lib/github";
import { readHistorialCompleto } from "@/lib/historialServidor";
import { ENTRADAS_MINIMAS, estadisticas, leerDiario, resultado, type Resultado } from "@/lib/diario";
import { Diario } from "@/components/Diario";

// Depende de la sesión y de datos que cambian: nunca se prerenderiza.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function uno(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export default async function PaginaDiario({ searchParams }: Props) {
  await requireSession();
  const params = await searchParams;

  const [{ assets }, raw, historial] = await Promise.all([
    cargarAssets(),
    readRaw(DIARIO_PATH, 30, "diario").catch(() => null),
    readHistorialCompleto(),
  ]);

  const entradas = raw ? leerDiario(raw) : [];
  const ahora = Date.now();

  // Resultados y estadísticas se calculan AQUÍ: el historial de un año son
  // cientos de miles de puntos, y al navegador solo le hacen falta los números.
  const resultados: Record<string, Resultado> = {};
  for (const e of entradas) resultados[e.id] = resultado(e, historial[e.activo] ?? [], ahora);

  return (
    <main className="shell">
      <header className="top">
        <h1>Diario</h1>
        <Link className="link" href="/">
          ← Panel
        </Link>
      </header>

      <p className="sub">
        Cada decisión con su motivo, escrito <strong>antes</strong> de saber cómo salió. A las{" "}
        {ENTRADAS_MINIMAS} entradas esto empieza a decir algo sobre ustedes, que es lo único que ninguna señal
        de mercado puede decirles.
      </p>

      <Diario
        entradas={entradas.slice().reverse()}
        resultados={resultados}
        stats={estadisticas(entradas, historial, ahora)}
        activos={assets.map((a) => ({ id: a.id, label: a.label || a.id }))}
        prefill={{ activo: uno(params.activo), aviso: uno(params.aviso) }}
      />
    </main>
  );
}
