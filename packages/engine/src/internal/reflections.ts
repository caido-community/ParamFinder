export function getReflectionVariations(value: string): string[] {
  const variations = new Set<string>([value]);
  const encoded = encodeURIComponent(value);

  if (encoded !== value) {
    variations.add(encoded);
  }

  if (value.includes("<") || value.includes(">")) {
    variations.add(value.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  }

  if (value.includes('"')) {
    variations.add(value.replace(/"/g, "&quot;"));
  }

  if (value.includes("'")) {
    variations.add(value.replace(/'/g, "&#39;"));
  }

  return Array.from(variations);
}
