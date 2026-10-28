export const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
export const nowISO = () => new Date().toISOString();
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const dateLabel = (value, options = {}) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', { day:'numeric', month:'short', ...(options.year ? {year:'numeric'} : {}), ...(options.time ? {hour:'2-digit', minute:'2-digit'} : {}), timeZone:'America/Bogota' }).format(date);
};
export const dayKey = date => {
  const d = new Date(date);
  return new Intl.DateTimeFormat('en-CA', { timeZone:'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
};
export const localInputDateTime = value => {
  if (!value) return '';
  const d = new Date(value); if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
  return parts.replace(' ', 'T');
};
export const dateFromLocalInput = value => {
  if (!value) return null;
  // The app uses America/Bogota (UTC-5 without daylight saving time).
  return new Date(`${value}:00-05:00`).toISOString();
};
export const relativeTime = value => {
  if (!value) return 'Sin fecha';
  const t = new Date(value).getTime(); if (!Number.isFinite(t)) return '';
  const delta = Date.now() - t;
  if (delta < 60000) return 'Ahora';
  if (delta < 3600000) return `Hace ${Math.floor(delta/60000)} min`;
  if (delta < 86400000) return `Hace ${Math.floor(delta/3600000)} h`;
  if (delta < 604800000) return `Hace ${Math.floor(delta/86400000)} d`;
  return dateLabel(value, {year: new Date(value).getFullYear() !== new Date().getFullYear()});
};
export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};
export const slug = value => String(value || 'nota').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'nota';
export const fmtBytes = bytes => {
  if (bytes == null) return 'No disponible';
  const units = ['B','KB','MB','GB']; let n = bytes, i = 0;
  while(n >= 1024 && i < units.length-1){n/=1024;i++;}
  return `${n.toLocaleString('es-CO',{maximumFractionDigits:1})} ${units[i]}`;
};
export function icon(name, size=18) {
 const paths = {
  plus:'<path d="M12 5v14M5 12h14"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', house:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', inbox:'<path d="M4 4h16l1 12h-6l-3 3-3-3H3z"/><path d="M3 12h5l2 3h4l2-3h5"/>', 'notebook-pen':'<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"/><path d="M8 3h11a2 2 0 0 1 2 2v7"/><path d="M8 3v18M7 8h5M7 12h5"/><path d="m14 19 5-5 2 2-5 5-3 1z"/>', 'file-pen-line':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h6"/><path d="M14 2v6h6M14 2l6 6M8 13h6M8 17h4"/><path d="m16 18 4-4 2 2-4 4-3 1z"/>', 'book-open':'<path d="M12 7v14M3 5a2 2 0 0 1 2-2h2a5 5 0 0 1 5 5v13a5 5 0 0 0-5-5H5a2 2 0 0 0-2 2zM21 5a2 2 0 0 0-2-2h-2a5 5 0 0 0-5 5v13a5 5 0 0 1 5-5h2a2 2 0 0 1 2 2z"/>', star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>', 'check-square':'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>', 'calendar-days':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>', 'table-2':'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10M15 10v10"/>', archive:'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M9 12h6"/>', 'trash-2':'<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/>', 'settings-2':'<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>', moon:'<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>', sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>', menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', 'panel-left':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 'more-horizontal':'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', 'arrow-left':'<path d="m12 19-7-7 7-7M5 12h14"/>', 'chevron-left':'<path d="m15 18-6-6 6-6"/>', 'chevron-right':'<path d="m9 18 6-6-6-6"/>', 'calendar-plus':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5"/>', 'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>', tag:'<path d="M20 13 13 20 3 10V3h7z"/><circle cx="7.5" cy="7.5" r="1"/>', folder:'<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', download:'<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>', upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 20h16"/>', lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/>', check:'<path d="m5 12 4 4L19 6"/>', 'circle-alert':'<circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>', x:'<path d="m18 6-12 12M6 6l12 12"/>', 'file-plus':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 12v6M9 15h6"/>', 'list-check':'<path d="m3 6 2 2 4-4M3 13l2 2 4-4M12 6h9M12 14h9M3 20h18"/>', 'eye':'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', 'shield-check':'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>', 'refresh-cw':'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 17.3 6L20 12M4 12l2.7 6A7 7 0 0 0 18.4 15"/>', 'sun-moon':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.07-7.07-1.42 1.42M6.35 17.65l-1.42 1.42M19.07 19.07l-1.42-1.42M6.35 6.35 4.93 4.93"/>', 'calendar-clock':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><circle cx="15" cy="15" r="3"/><path d="M15 13.5v1.7l1 0.6"/>', 'external-link':'<path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 'type':'<path d="M4 7V4h16v3M9 20h6M12 4v16"/>', bold:'<path d="M6 12h8a4 4 0 0 0 0-8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>', italic:'<path d="M19 4h-9M14 20H5M15 4 9 20"/>', 'list':'<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>', 'quote':'<path d="M3 21c3 0 6-3 6-7V5H3v6h3c0 2-1 3-3 3v7ZM15 21c3 0 6-3 6-7V5h-6v6h3c0 2-1 3-3 3v7Z"/>', 'undo':'<path d="M3 7v6h6M21 17a8 8 0 0 0-14-5L3 13"/>', 'redo':'<path d="M21 7v6h-6M3 17a8 8 0 0 1 14-5l4 1"/>'
 };
 return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths['file-text']}</svg>`;
}
