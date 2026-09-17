"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <main className="login">
      <h1>Vigilante de precios</h1>
      <form action={action}>
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
        />
        <button className="primary" disabled={pending}>
          {pending ? "Comprobando…" : "Entrar"}
        </button>
        {state.error && (
          <p className="aviso aviso-error" role="alert" style={{ marginTop: "0.85rem" }}>
            {state.error}
          </p>
        )}
      </form>
    </main>
  );
}
