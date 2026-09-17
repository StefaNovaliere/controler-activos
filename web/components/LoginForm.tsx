"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/login/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
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
        <p
          className={`aviso ${state.config ? "aviso-ambar" : "aviso-error"}`}
          role="alert"
          style={{ marginTop: "0.85rem" }}
        >
          {state.error}
          {state.config && (
            <>
              <br />
              <small>
                No es cosa tuya: ninguna contraseña funcionará hasta arreglarlo.
              </small>
            </>
          )}
        </p>
      )}
    </form>
  );
}
