// Accepts what people type ("example.com", "https://x.test/a") and returns a safe http(s)/file URL, or null.
export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text
  if (!/^(https?|file):/i.test(candidate)) return null
  try {
    const parsed = new URL(candidate)
    if (/^https?:$/.test(parsed.protocol) && !parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return null
    return parsed.href
  } catch { return null }
}
