/* Minimal node typings for unit tests only. The app ships no node imports;
   if @types/node is ever installed, these module declarations merge safely. */
declare module "node:fs" {
  export function readFileSync(path: unknown, encoding: "utf8"): string;
}

declare module "node:zlib" {
  export function gzipSync(input: Uint8Array): { readonly length: number };
}
