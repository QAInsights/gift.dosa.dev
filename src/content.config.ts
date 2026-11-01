import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "zod";

const library = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/library" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    kind: z.enum(["article", "guide"]).default("article"),
    retailer: z.string().optional(),
    published: z.coerce.date(),
    updated: z.coerce.date().optional(),
    faqs: z
      .array(z.object({ q: z.string(), a: z.string() }))
      .default([]),
  }),
});

export const collections = { library };
