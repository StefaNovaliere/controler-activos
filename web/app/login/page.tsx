import { missingEnv } from "@/lib/auth";
import { LoginForm } from "@/components/LoginForm";

// Sin esto, Next prerenderiza esta página en el build y el aviso de variables
// ausentes queda congelado en lo que hubiera EN EL BUILD. Justo el caso que hay
// que detectar —añades las variables y vuelves a desplegar— mostraría un estado
// viejo, que es peor que no avisar.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  // Solo los nombres, nunca los valores. En un despliegue bien configurado este
  // aviso no aparece jamás; cuando aparece, ahorra una tarde.
  const faltan = missingEnv();

  return (
    <main className="login">
      <h1>Centinela de precios</h1>

      {faltan.length > 0 && (
        <div className="aviso aviso-ambar" role="alert">
          Faltan variables de entorno en este despliegue:
          <ul>
            {faltan.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          Añádelas en Vercel → Settings → Environment Variables, marcando{" "}
          <strong>Production</strong>, y <strong>vuelve a desplegar</strong>: las
          variables nuevas no se aplican a un despliegue ya hecho.
        </div>
      )}

      <LoginForm />
    </main>
  );
}
