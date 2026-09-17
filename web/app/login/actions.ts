"use server";

import { redirect } from "next/navigation";
import { checkPassword } from "@/lib/auth";
import { createSession, destroySession } from "@/lib/session";

export type LoginState = { error?: string };

export async function loginAction(_previous: LoginState, form: FormData): Promise<LoginState> {
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
