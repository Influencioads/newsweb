/**
 * Save `url` as `filename`. A cross-origin `<a download>` is ignored by the
 * browser, so the file is fetched into a blob first; a CDN without CORS still
 * opens in a new tab, where the editor saves it by hand.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const href = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = href;
    a.download = filename;
    a.click();
    // Not at once: Firefox and Safari can drop a download whose URL is revoked in the same turn.
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}
