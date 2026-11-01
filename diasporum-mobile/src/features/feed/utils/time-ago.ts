/** Relative timestamp: "now", "5m", "2h", "3d", "Jan 5" */
export function timeAgo(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  const date = new Date(iso);
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
