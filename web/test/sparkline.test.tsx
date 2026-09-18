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
    render(<Sparkline puntos={serie([0.08])} lower={0.07} upper={0.09} divisa="usd" etiqueta="DOGE" />);
    expect(screen.getByText(/Sin historial todavía/)).toBeDefined();
  });

  it("dibuja una línea por cada umbral configurado, y solo esas", () => {
    const { container } = render(
      <Sparkline puntos={serie([0.08, 0.085])} lower={0.07} upper={null} divisa="usd" etiqueta="DOGE" />,
    );
    expect(umbrales(container)).toHaveLength(1);
  });

  it("la escala abarca los umbrales, no solo los precios", () => {
    // Si no, un umbral lejano quedaría fuera del dibujo y la pregunta que este
    // gráfico contesta —¿está cerca de cruzarlo?— no se podría contestar.
    const { container } = render(
      <Sparkline puntos={serie([100, 101])} lower={50} upper={200} divisa="usd" etiqueta="X" />,
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
      <Sparkline puntos={conHueco} lower={null} upper={null} divisa="usd" etiqueta="X" />,
    );
    const d = container.querySelector("path")!.getAttribute("d")!;
    const xs = [...d.matchAll(/[ML]([\d.]+),/g)].map((m) => Number(m[1]));
    // El salto del segundo al tercer punto tiene que ser mucho mayor que el del
    // primero al segundo, porque pasaron ocho horas en vez de una.
    expect(xs[2] - xs[1]).toBeGreaterThan((xs[1] - xs[0]) * 5);
  });

  it("describe la serie para quien no puede verla", () => {
    render(<Sparkline puntos={serie([1, 3, 2])} lower={null} upper={null} divisa="usd" etiqueta="DOGE" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/DOGE: 3 precios/);
  });

  it("el punto de ahora es el último, no el más alto", () => {
    const { container } = render(
      <Sparkline puntos={serie([1, 9, 2])} lower={null} upper={null} divisa="usd" etiqueta="X" />,
    );
    const circulo = container.querySelector("circle")!;
    const d = container.querySelector("path")!.getAttribute("d")!;
    const ultimo = d.split(" ").pop()!.replace("L", "").split(",");
    expect(Number(circulo.getAttribute("cx"))).toBeCloseTo(Number(ultimo[0]), 1);
    expect(Number(circulo.getAttribute("cy"))).toBeCloseTo(Number(ultimo[1]), 1);
  });
});
