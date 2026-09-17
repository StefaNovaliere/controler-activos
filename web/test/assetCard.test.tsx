// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AssetInput } from "../lib/types";

// La tarjeta importa una Server Action; en el navegador de prueba no existe y
// tampoco hace falta para lo que se comprueba aquí.
vi.mock("@/app/actions/config", () => ({
  probarAction: vi.fn(async () => ({ ok: false, error: "sin red" })),
}));

const { AssetCard } = await import("../components/AssetCard");

function nuevo(overrides: Partial<AssetInput> = {}): AssetInput {
  return {
    id: "asd",
    label: "asd",
    provider: "coingecko",
    symbol: "",
    currency: "usd",
    lower: null,
    upper: null,
    enabled: true,
    ...overrides,
  };
}

/** La tarjeta no guarda el activo: lo hace el panel. Sin este envoltorio, el
 *  `onChange` se perdería y teclear no cambiaría nada, que es justo el caso que
 *  hay que reproducir. */
function Anfitrion({ inicial }: { inicial: AssetInput }) {
  const [asset, setAsset] = useState(inicial);
  return (
    <AssetCard
      asset={asset}
      estado={undefined}
      abierto
      onToggle={() => {}}
      onChange={setAsset}
      onDelete={() => {}}
    />
  );
}

afterEach(cleanup);

describe("Configuración avanzada de un activo", () => {
  it("sigue abierta al escribir el símbolo", () => {
    // Estaba como `open={!asset.symbol}`: la primera letra hacía que el símbolo
    // dejara de estar vacío, React cerraba el <details> y se llevaba el cursor.
    // El campo se cerraba justo al empezar a usarlo.
    render(<Anfitrion inicial={nuevo()} />);

    const detalle = screen.getByText("Configuración avanzada").closest("details")!;
    expect(detalle.open).toBe(true);

    fireEvent.change(screen.getByLabelText(/Símbolo/), { target: { value: "m" } });

    expect(detalle.open).toBe(true);
    expect((screen.getByLabelText(/Símbolo/) as HTMLInputElement).value).toBe("m");

    // Y no solo la primera letra: tampoco al borrarlo entero y volver a empezar.
    fireEvent.change(screen.getByLabelText(/Símbolo/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Símbolo/), { target: { value: "marscoin" } });
    expect(detalle.open).toBe(true);
  });

  it("se abre sola si el activo aún no tiene símbolo", () => {
    // Es la razón por la que existía ese `open`: un activo añadido a mano llega
    // sin símbolo y el símbolo se pone aquí dentro.
    render(<Anfitrion inicial={nuevo()} />);
    expect(screen.getByText("Configuración avanzada").closest("details")!.open).toBe(true);
  });

  it("nace plegada si el activo ya tiene símbolo", () => {
    render(<Anfitrion inicial={nuevo({ symbol: "bitcoin" })} />);
    expect(screen.getByText("Configuración avanzada").closest("details")!.open).toBe(false);
  });

  it("respeta que la cierres a mano", () => {
    render(<Anfitrion inicial={nuevo()} />);
    const detalle = screen.getByText("Configuración avanzada").closest("details")!;

    detalle.open = false;
    fireEvent(detalle, new Event("toggle"));
    expect(detalle.open).toBe(false);

    // Y escribir en el nombre, que provoca un re-render, no la reabre.
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "otro" } });
    expect(detalle.open).toBe(false);
  });
});
