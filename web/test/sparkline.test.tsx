// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Sparkline } from "../components/Sparkline";
import type { PuntoHistorial } from "../lib/historial";

const HORA = 3_600_000;
const T0 = Date.UTC(2026, 8, 11);

function serie(precios: number[]): PuntoHistorial[] {
  return precios.map((precio, i) => ({ t: T0 + i * HORA, precio }));
}

/** Las líneas de umbral son las <line> punteadas; la del precio es el <path>. */
function umbrales(contenedor: HTMLElement): SVGLineElement[] {
  return Array.from(contenedor.querySelectorAll("line[stroke-dasharray]"));
}

afterEach(cleanup);

describe("el gráfico de la baldosa", () => {
  it("con menos de dos puntos dice que no hay historia, en vez de fingir una línea", () => {
    render(<Sparkline puntos={serie([0.08])} lower={0.07} upper={0.09} giroBaja={null} giroSube={null} divisa="usd" etiqueta="DOGE" />);
    expect(screen.getByText(/Sin historial todavía/)).toBeDefined();
  });

  it("dibuja una línea por cada umbral configurado, y solo esas", () => {
    const { container } = render(
      <Sparkline puntos={serie([0.08, 0.085])} lower={0.07} upper={null} giroBaja={null} giroSube={null} divisa="usd" etiqueta="DOGE" />,
    );
    expect(umbrales(container)).toHaveLength(1);
  });

  it("la escala abarca los umbrales, no solo los precios", () => {
    // Si no, un umbral lejano quedaría fuera del dibujo y la pregunta que este
    // gráfico contesta —¿está cerca de cruzarlo?— no se podría contestar.
    const { container } = render(
      <Sparkline puntos={serie([100, 101])} lower={50} upper={200} giroBaja={null} giroSube={null} divisa="usd" etiqueta="X" />,
    );
    const [inferior, superior] = umbrales(container);
    const ys = [inferior, superior].map((l) => Number(l.getAttribute("y1")));
    // El de abajo se dibuja MÁS ABAJO (y mayor) que el de arriba: en SVG el eje
    // crece hacia abajo. Es la codificación secundaria que hace que el par
    // azul/verde no dependa solo del color.
    expect(ys[0]).toBeGreaterThan(ys[1]);
    // Y ambos dentro del lienzo, no recortados fuera.
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(0);
  });

  it("el eje del tiempo respeta los huecos del cron", () => {
    // Los puntos los pone el cron y GitHub se salta ejecuciones. Repartirlos a
    // distancias iguales pintaría un parón de seis horas como una línea recta
    // de mercado tranquilo.
    const conHueco: PuntoHistorial[] = [
      { t: T0, precio: 1 },
      { t: T0 + HORA, precio: 2 },
      { t: T0 + 9 * HORA, precio: 3 },
    ];
    const { container } = render(
      <Sparkline puntos={conHueco} lower={null} upper={null} giroBaja={null} giroSube={null} divisa="usd" etiqueta="X" />,
    );
    const d = container.querySelector("path")!.getAttribute("d")!;
    const xs = [...d.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]));
    // El salto del segundo al tercer punto tiene que ser mucho mayor que el del
    // primero al segundo, porque pasaron ocho horas en vez de una.
    expect(xs[2] - xs[1]).toBeGreaterThan((xs[1] - xs[0]) * 5);
  });

  it("describe la serie para quien no puede verla", () => {
    render(<Sparkline puntos={serie([1, 3, 2])} lower={null} upper={null} giroBaja={null} giroSube={null} divisa="usd" etiqueta="DOGE" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/DOGE: 3 precios/);
  });

  it("el punto de ahora es el último, no el más alto", () => {
    const { container } = render(
      <Sparkline puntos={serie([1, 9, 2])} lower={null} upper={null} giroBaja={null} giroSube={null} divisa="usd" etiqueta="X" />,
    );
    const circulo = container.querySelector("circle")!;
    const d = container.querySelector("path")!.getAttribute("d")!;
    const ultimo = d.split(" ").pop()!.replace("L", "").split(",");
    expect(Number(circulo.getAttribute("cx"))).toBeCloseTo(Number(ultimo[0]), 1);
    expect(Number(circulo.getAttribute("cy"))).toBeCloseTo(Number(ultimo[1]), 1);
  });
});

describe("los avisos de giro también se dibujan", () => {
  it("con un trazo distinto del de los umbrales fijos", () => {
    // Los dos son líneas de referencia y comparten familia de color, así que el
    // patrón de trazo es lo que los separa: a rayas el fijo, punteado el que se
    // mueve solo.
    const { container } = render(
      <Sparkline
        puntos={serie([10, 9, 8])}
        lower={7}
        upper={null}
        giroBaja={8.5}
        giroSube={null}
        divisa="usd"
        etiqueta="X"
      />,
    );
    const trazos = Array.from(container.querySelectorAll("line[stroke-dasharray]")).map((l) =>
      l.getAttribute("stroke-dasharray"),
    );
    expect(new Set(trazos).size).toBe(2);
  });

  it("la escala los abarca: un nivel fuera del dibujo no contesta nada", () => {
    const { container } = render(
      <Sparkline
        puntos={serie([100, 101])}
        lower={null}
        upper={null}
        giroBaja={40}
        giroSube={null}
        divisa="usd"
        etiqueta="X"
      />,
    );
    const y = Number(container.querySelector("line[stroke-dasharray]")!.getAttribute("y1"));
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(56);
  });

  it("la leyenda no nombra un umbral fijo que no existe", () => {
    render(
      <Sparkline puntos={serie([10, 9])} lower={null} upper={null} giroBaja={8.5} giroSube={null}
                 divisa="usd" etiqueta="X" />,
    );
    expect(screen.getByText(/aviso de giro/)).toBeDefined();
    expect(screen.queryByText(/umbral fijo/)).toBeNull();
  });

  it("explica los dos trazos cuando hay giro, que el color solo ya no basta", () => {
    render(
      <Sparkline
        puntos={serie([10, 9])}
        lower={7}
        upper={null}
        giroBaja={8.5}
        giroSube={null}
        divisa="usd"
        etiqueta="X"
      />,
    );
    expect(screen.getByText(/aviso de giro/)).toBeDefined();
  });
});

describe("el pie dice cuánto tiempo abarca", () => {
  it("en tiempo, no en número de ejecuciones del cron", () => {
    // «últimos 120 registros» es la unidad de dentro; con un selector de
    // periodo, lo que importa es cuánto tiempo se está viendo.
    const tresDias = Array.from({ length: 40 }, (_, i) => ({
      t: T0 + i * 1.8 * HORA,
      precio: 10 + i,
    }));
    render(
      <Sparkline puntos={tresDias} lower={null} upper={null} giroBaja={null} giroSube={null}
                 divisa="usd" etiqueta="X" />,
    );
    expect(screen.getByText(/3 días/)).toBeDefined();
  });
});

describe("el pie describe el precio, no el dibujo", () => {
  it("un umbral lejano no se cuela como si fuera un precio alcanzado", () => {
    // La escala SÍ tiene que abarcar los umbrales, o no se vería si el precio
    // se acerca. Pero el pie decía «0,26 a 0,39» con la línea casi plana,
    // porque 0,26 era un umbral y no un precio que el activo llegara a tocar.
    render(
      <Sparkline puntos={serie([100, 101, 102])} lower={10} upper={500} giroBaja={null}
                 giroSube={null} divisa="usd" etiqueta="X" />,
    );
    expect(screen.getByText(/100 USD a 102 USD/)).toBeDefined();
    expect(screen.queryByText(/500/)).toBeNull();
  });
});
