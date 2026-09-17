"use server";

import { redirect } from "next/navigation";
import { checkPassword, passwordStatus } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";

export type LoginState = { error?: string; config?: boolean };

export async function loginAction(_previous: LoginState, form: FormData): Promise<LoginState> {
  const estado = passwordStatus();
  if (estado !== "ok") {
    // Ningún intento va a funcionar: decirlo ahorra buscar el fallo donde no está.
    return {
      config: true,
      error:
        estado === "missing"
          ? "El panel no tiene contraseña configurada: falta PANEL_PASSWORD_HASH en Vercel."
          : "PANEL_PASSWORD_HASH está mal copiado: tiene que empezar por «scrypt:» y llevar dos signos de dos puntos.",
    };
  }

  const password = String(form.get("password") ?? "");
  if (await checkPassword(password)) {
    await createSession();
    redirect("/"); // redirect() lanza por dentro: va fuera de cualquier try
  }

  // No frena a nadie por sí solo (el coste de scrypt ya son ~100 ms), pero aplana
  // el canal temporal residual. El freno de verdad es una contraseña generada,
  // y una regla de rate limiting en el firewall de Vercel.
  await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 250));
  return { error: "Contraseña incorrecta." };
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
