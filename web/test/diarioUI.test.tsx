// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Entrada, Estadisticas, Resultado } from "../lib/diario";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const anotarAction = vi.fn(async (..._: unknown[]) => ({ ok: true as const }));
const revisarAction = vi.fn(async (..._: unknown[]) => ({ ok: true as const }));
vi.mock("@/app/actions/diario", () => ({
  anotarAction: (...a: unknown[]) => anotarAction(...a),
  revisarAction: (...a: unknown[]) => revisarAction(...a),
}));

const { Diario } = await import("../components/Diario");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

const STATS: Estadisticas = {
  total: 1,
  faltan: 29,
  revisadas: 0,
  porDecision: { comprar: 1, vender: 0, mantener: 0, "no-hacer-nada": 0 },
  plan: { si: 1, no: 0, "sin-plan": 0 },
  siguiendoPlan: { n: 1, aciertos: 1 },
  sinSeguirPlan: { n: 0, aciertos: 0 },
  cuadrante: { buenaBien: 0, buenaMal: 0, malaBien: 0, malaMal: 0 },
};

const ACTIVOS = [
  { id: "btc", label: "Bitcoin" },
  { id: "pepe", label: "PEPE" },
];

const ENTRADA: Entrada = {
  id: "x1",
  creado: "2026-10-01T12:00:00Z",
  quien: "Stefano",
  activo: "pepe",
  decision: "comprar",
  origen: "aviso",
  motivo: "rompió el umbral con volumen alto",
  siguioPlan: "si",
};

const MEDIDO: Resultado = { estado: "medido", cambioPct: 12.5, acerto: true };

function pintar(opciones: { entradas?: Entrada[]; prefill?: { activo: string | null; aviso: string | null } } = {}) {
  return render(
    <Diario
      entradas={opciones.entradas ?? [ENTRADA]}
      resultados={{ x1: MEDIDO }}
      stats={STATS}
      activos={ACTIVOS}
      prefill={opciones.prefill ?? { activo: null, aviso: null }}
    />,
  );
}

describe("anotar", () => {
  it("el enlace del aviso deja el activo elegido", () => {
    pintar({ prefill: { activo: "pepe", aviso: "BELOW_LOWER" } });
    expect((screen.getByLabelText("Activo") as HTMLSelectElement).value).toBe("pepe");
    expect(screen.getByText(/Viene de un aviso/)).toBeTruthy();
  });

  it("recuerda quién escribe", async () => {
    localStorage.setItem("centinela:quien", "Juan");
    await act(async () => {
      pintar();
    });
    expect((screen.getByLabelText("Quién") as HTMLInputElement).value).toBe("Juan");
  });

  it("avisa que es público, y más fuerte si parece un monto", () => {
    pintar();
    expect(screen.getByText(/repositorio, que es público/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Por qué/), { target: { value: "puse $50 porque rompió" } });
    expect(screen.getByText(/Parece que escribiste un monto/)).toBeTruthy();
  });

  it("sin decisión no se envía", () => {
    pintar();
    fireEvent.click(screen.getByText("Anotar"));
    expect(anotarAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Elige qué decidiste/)).toBeTruthy();
  });

  it("envía lo elegido, con el aviso como origen", async () => {
    pintar({ prefill: { activo: "pepe", aviso: "BELOW_LOWER" } });
    fireEvent.change(screen.getByLabelText("Quién"), { target: { value: "Stefano" } });
    fireEvent.click(screen.getByText("No hacer nada"));
    fireEvent.click(screen.getByText("Sí"));
    fireEvent.change(screen.getByLabelText(/Por qué/), { target: { value: "ya rompió y llego tarde, espero" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Anotar"));
    });
    expect(anotarAction).toHaveBeenCalledWith({
      quien: "Stefano",
      activo: "pepe",
      decision: "no-hacer-nada",
      siguioPlan: "si",
      motivo: "ya rompió y llego tarde, espero",
      origen: "aviso",
      aviso: "BELOW_LOWER",
    });
    expect(refresh).toHaveBeenCalled();
    expect(localStorage.getItem("centinela:quien")).toBe("Stefano");
  });
});

describe("revisar", () => {
  it("el resultado no se ve hasta juzgar la decisión", async () => {
    pintar();
    // Si se viera antes, el juicio se contaminaría con el resultado.
    expect(screen.queryByText(/12,5/)).toBeNull();
    fireEvent.click(screen.getByText("Revisar"));
    expect(screen.queryByText(/12,5/)).toBeNull();
    expect(screen.getByText("Guardar juicio y ver el resultado").hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByText("Buena"));
    await act(async () => {
      fireEvent.click(screen.getByText("Guardar juicio y ver el resultado"));
    });
    expect(revisarAction).toHaveBeenCalledWith("x1", "buena", "");
    expect(refresh).toHaveBeenCalled();
  });

  it("una vez juzgada, enseña el juicio y el resultado", () => {
    pintar({ entradas: [{ ...ENTRADA, revision: { creado: "y", juicio: "buena", nota: "seguí el plan" } }] });
    expect(screen.getByText(/Decisión buena/)).toBeTruthy();
    expect(screen.getByText(/12,5/)).toBeTruthy();
    expect(screen.getByText(/acertó la dirección/)).toBeTruthy();
    expect(screen.queryByText("Revisar")).toBeNull();
  });
});

describe("resumen", () => {
  it("con pocas entradas, cuentas y no porcentajes", () => {
    pintar();
    expect(screen.getByText(/Faltan 29/)).toBeTruthy();
    expect(screen.getByText(/1 de 1/)).toBeTruthy();
    expect(screen.queryByText(/100 %/)).toBeNull();
  });
});
