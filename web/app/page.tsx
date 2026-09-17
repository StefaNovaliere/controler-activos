import { requireSession } from "@/lib/dal";
import { cargarAssets } from "@/app/actions/config";
import { logoutAction } from "@/app/login/actions";
import { readState } from "@/lib/state";
import { tokenExpiry } from "@/lib/github";
import { Panel } from "@/components/Panel";
import { Freshness } from "@/components/Freshness";

export default async function Home() {
  await requireSession();

  const [{ assets, providers }, estado, expira] = await Promise.all([
    cargarAssets(),
    readState(),
    tokenExpiry(),
  ]);

  const activos = assets.filter((a) => a.enabled).length;

  return (
    <main className="shell">
      <header className="top">
        <h1>Centinela de precios</h1>
        <form action={logoutAction}>
          <button className="link">Cerrar sesión</button>
        </form>
      </header>

      <p className="sub">
        {activos} activo{activos === 1 ? "" : "s"} en vigilancia
        {assets.length > activos && ` · ${assets.length - activos} en pausa`}. Te avisa por Telegram
        solo cuando un precio <strong>cruza</strong> uno de tus umbrales.
      </p>

      <Freshness updatedAt={estado?.updated_at ?? null} />
      <CaducidadToken expira={expira} />

      <Panel inicial={assets} estados={estado?.assets ?? {}} providers={providers} />
    </main>
  );
}

/** Los tokens fine-grained caducan a la fuerza, y el día que lo hacen el panel
 *  deja de guardar con un 401 que no dice nada. Mejor avisar antes. */
function CaducidadToken({ expira }: { expira: string | null }) {
  if (!expira) return null;
  const dias = Math.round((Date.parse(expira) - Date.now()) / 86_400_000);
  if (!Number.isFinite(dias) || dias > 14) return null;

  return (
    <p className="aviso aviso-ambar">
      El token de GitHub caduca en {dias} día{dias === 1 ? "" : "s"}. Cuando caduque, el panel podrá
      leer pero no guardar: renuévalo en GitHub y actualiza <code>GITHUB_TOKEN</code> en Vercel.
    </p>
  );
}
