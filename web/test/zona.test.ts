import { describe, expect, it } from "vitest";
import { etiquetaZona, zonaVista } from "../lib/zona";

const etiqueta = (...args: Parameters<typeof zonaVista>) => etiquetaZona(zonaVista(...args));

describe("la etiqueta no puede contradecir a los números que tiene debajo", () => {
  it("el caso real: XRP a 1,43 con el aviso de subida en 1,50", () => {
    // El bot había guardado «above» con el umbral anterior. Entre el cambio y
    // la siguiente ejecución del cron, el panel enseñaba esa conclusión vieja
    // pegada a los números nuevos.
    expect(etiqueta(1.43, 1.37, 1.5, "above", true)).toBe("dentro del rango");
  });

  it("y Bitcoin a 81.452 con el suyo en 84.000", () => {
    expect(etiqueta(81452, 79100, 84000, "above", true)).toBe("dentro del rango");
  });

  it("cuando sí está fuera, lo dice", () => {
    expect(etiqueta(1.6, 1.37, 1.5, "inside", true)).toBe("por encima");
    expect(etiqueta(1.2, 1.37, 1.5, "inside", true)).toBe("por debajo");
  });

  it("la histéresis sigue funcionando: rozar el umbral al volver no basta", () => {
    // Misma regla que el motor, que es el punto de reusar `clasificar()`.
    expect(etiqueta(1.501, 1.37, 1.5, "above", true)).toBe("por encima");
    expect(etiqueta(1.49, 1.37, 1.5, "above", true)).toBe("dentro del rango");
  });
});

describe("los casos que no son una zona", () => {
  it("sin precio todavía no se inventa una", () => {
    expect(etiqueta(null, 1, 2, null, true)).toBe("sin datos aún");
  });

  it("en pausa manda sobre todo lo demás", () => {
    expect(etiqueta(1.43, 1.37, 1.5, "above", false)).toBe("en pausa");
  });

  it("sin umbrales fijos no hay rango del que estar dentro", () => {
    // Un activo que solo vigila giros no está «dentro del rango»: no hay rango.
    // Decirlo sería tan falso como el cartel que este módulo arregla.
    expect(etiqueta(1.43, null, null, null, true)).toBe("vigilando");
  });

  it("con un solo umbral sí hay zona", () => {
    expect(etiqueta(1.43, null, 1.5, null, true)).toBe("dentro del rango");
    expect(etiqueta(1.6, null, 1.5, null, true)).toBe("por encima");
  });
});
