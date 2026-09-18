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
      historial={[]}
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

describe("la coma decimal, que aquí es el separador normal", () => {
  it("escribir «0,6» guarda 0.6, no NaN", () => {
    // `Number("0,6")` es NaN: el resumen decía «te avisará si baja de NaN» y el
    // YAML acababa con un valor que pydantic rechaza. Escribir un decimal de la
    // forma natural del idioma dejaba el formulario sin poder guardarse.
    render(<Anfitrion inicial={nuevo({ symbol: "bitcoin", lower: "1" })} />);

    // Por rol: «Avísame si BAJA de» etiqueta también a la casilla que activa el
    // umbral, y buscar solo por texto encuentra las dos.
    const campo = screen.getByRole("textbox", { name: /BAJA/ });
    fireEvent.change(campo, { target: { value: "0,6" } });

    expect((campo as HTMLInputElement).value).toBe("0.6");
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("un umbral ya guardado con coma se enseña como número, no como NaN", () => {
    render(<Anfitrion inicial={nuevo({ symbol: "bitcoin", lower: "0,6", upper: "1,96" })} />);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});

describe("los avisos de giro dicen que son porcentajes", () => {
  it("el % va pegado al número, y hay un ejemplo con cifras", () => {
    // Alguien miró «43» y preguntó qué era. El «%» estaba ahí, pero al otro
    // extremo de un campo que ocupaba toda la fila.
    render(
      <Anfitrion
        inicial={nuevo({ symbol: "bitcoin", trailing: { drop_pct: "43", rise_pct: null } })}
      />,
    );

    expect(screen.getByRole("textbox", { name: /CAE desde su máximo/ })).toBeDefined();
    // El ejemplo traduce el porcentaje a precios, que es lo que se estaba
    // preguntando de verdad: «¿y eso qué significa?».
    expect(screen.getByText(/Si llega a 1,00 y luego baja a 0,57/)).toBeDefined();
  });

  it("sin porcentaje escrito no se enseña un ejemplo inventado", () => {
    render(<Anfitrion inicial={nuevo({ symbol: "bitcoin", trailing: { drop_pct: "", rise_pct: null } })} />);
    expect(screen.queryByText(/te avisa\./)).toBeNull();
  });
});

describe("el plan de salida", () => {
  it("cada objetivo se enseña como múltiplo de tu entrada", () => {
    // «2x» se entiende sin hacer cuentas; «0,16 USD» no.
    render(
      <Anfitrion
        inicial={nuevo({
          symbol: "dogecoin",
          entry_price: "0.08",
          exits: [{ price: "0.16", sell_pct: "25", note: null }],
        })}
      />,
    );
    expect(screen.getByText("2,0x")).toBeDefined();
  });

  it("dice cuánto dejas corriendo, no solo cuánto vendes", () => {
    render(
      <Anfitrion
        inicial={nuevo({
          symbol: "dogecoin",
          exits: [
            { price: "0.16", sell_pct: "25", note: null },
            { price: "0.24", sell_pct: "25", note: null },
          ],
        })}
      />,
    );
    expect(screen.getByText(/dejas correr el 50 %/)).toBeDefined();
  });

  it("quitar un objetivo lo quita de verdad", () => {
    render(
      <Anfitrion
        inicial={nuevo({
          symbol: "dogecoin",
          exits: [
            { price: "0.16", sell_pct: "25", note: null },
            { price: "0.24", sell_pct: "25", note: null },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Quitar el objetivo 1"));
    expect(screen.queryByDisplayValue("0.16")).toBeNull();
    expect(screen.getByDisplayValue("0.24")).toBeDefined();
  });
});

describe("cuánto pongo", () => {
  it("no reclama nada antes de que hayas puesto tu capital", () => {
    render(<Anfitrion inicial={nuevo({ symbol: "dogecoin", lower: null, entry_price: "1" })} />);
    expect(screen.queryByText(/Sin stop no hay cuenta posible/)).toBeNull();
  });

  it("con capital pero sin stop no inventa un número: dice cómo ponerlo", () => {
    // Si no sabes dónde admitirías estar equivocado, no hay forma de saber
    // cuánto arriesgas. Inventar un tamaño ahí sería lo peor que podría hacer.
    localStorage.setItem("centinela:capital", "1000");
    render(<Anfitrion inicial={nuevo({ symbol: "dogecoin", lower: null, entry_price: "1" })} />);
    expect(screen.getByText(/Sin stop no hay cuenta posible/)).toBeDefined();
    localStorage.clear();
  });

  it("con capital, entrada y stop da el tamaño y la pérdida en dinero", () => {
    localStorage.setItem("centinela:capital", "1000");
    localStorage.setItem("centinela:riesgo", "2");
    render(<Anfitrion inicial={nuevo({ symbol: "dogecoin", lower: "0.6", entry_price: "1" })} />);
    // 2 % de 1000 = 20 de riesgo, stop al 40 % -> posición de 50.
    expect(screen.getByText(/50 USD/)).toBeDefined();
    expect(screen.getByText(/20 USD/)).toBeDefined();
    localStorage.clear();
  });

  it("avisa de que el capital no se guarda en el repositorio", () => {
    // El repositorio es público: cuánto dinero tiene alguien no puede acabar
    // en un commit, y hay que decirlo donde se teclea.
    render(<Anfitrion inicial={nuevo({ symbol: "dogecoin" })} />);
    expect(screen.getByText(/no se guarda en el repositorio/)).toBeDefined();
  });
});

describe("la revisión del token", () => {
  it("se ofrece para las criptos, no para las acciones", () => {
    // Una acción no tiene contrato que revisar: ofrecerlo ahí sería ruido.
    render(<Anfitrion inicial={nuevo({ symbol: "dogecoin", provider: "coingecko" })} />);
    expect(screen.getByText("Revisar el token")).toBeDefined();

    cleanup();
    render(<Anfitrion inicial={nuevo({ symbol: "AAPL", provider: "twelvedata" })} />);
    expect(screen.queryByText("Revisar el token")).toBeNull();
  });
});
