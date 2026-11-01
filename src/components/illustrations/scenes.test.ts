import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCENES } from "./scenes";

const cssPath = new URL("../../styles/motion.css", import.meta.url);
const controllerPath = new URL("../../scripts/motion.ts", import.meta.url);
const css = readFileSync(cssPath, "utf8");
const controller = readFileSync(controllerPath, "utf8");

const gzipBytes = (text: string): number => gzipSync(new TextEncoder().encode(text)).length;

function keyframeBodies(source: string): string[] {
  const bodies: string[] = [];
  const re = /@keyframes [a-z-]+\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    bodies.push(source.slice(match.index + match[0].length, i - 1));
  }
  return bodies;
}

describe("motion payload budgets", () => {
  it("keeps each route's SVG under 2 KiB gzip", () => {
    for (const [id, scene] of Object.entries(SCENES)) {
      expect(gzipBytes(scene.svg), id).toBeLessThanOrEqual(2048);
    }
  });

  it("keeps shared illustration CSS under 2 KiB gzip", () => {
    expect(gzipBytes(css)).toBeLessThanOrEqual(2048);
  });

  it("keeps the lifecycle controller source under 1 KiB gzip", () => {
    expect(gzipBytes(controller)).toBeLessThanOrEqual(1024);
  });
});

describe("motion artwork hygiene", () => {
  it("renders decorative, self-contained SVG without ids, text, or URLs", () => {
    for (const [id, scene] of Object.entries(SCENES)) {
      expect(scene.svg, `${id} viewBox`).toContain("viewBox=");
      expect(scene.svg, `${id} hidden`).toContain('aria-hidden="true"');
      expect(scene.svg, `${id} unfocusable`).toContain('focusable="false"');
      expect(scene.svg, `${id} no ids`).not.toContain("id=");
      expect(scene.svg, `${id} no text`).not.toContain("<text");
      expect(scene.svg, `${id} no urls`).not.toContain("http");
      expect(scene.svg, `${id} no handlers`).not.toMatch(/on\w+=/);
    }
  });

  it("animates transform and opacity only", () => {
    const bodies = keyframeBodies(css);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const prop of props) {
        expect(["transform", "opacity"], prop).toContain(prop);
      }
    }
  });

  it("freezes artwork under reduced motion", () => {
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toMatch(/\.motion-fig\.motion-run \.fx\s*\{\s*animation:\s*none/);
  });

  it("runs the controller without timers, loops, or network", () => {
    expect(controller).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|fetch\(|XMLHttpRequest/);
    expect(controller).toContain("IntersectionObserver");
    expect(controller).toContain("visibilitychange");
    expect(controller).toContain("prefers-reduced-motion");
  });
});
