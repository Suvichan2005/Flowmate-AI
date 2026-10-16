// Local presentation preference only. Blocking same-origin script runs before paint.
(() => {
 let id = 'forest';
 try { const stored = localStorage.getItem('flowmate.appearance.v1'); if (['forest','ocean','plum','slate'].includes(stored)) id = stored; } catch { /* Storage denied: keep default. */ }
 document.documentElement.dataset.theme = id;
})();
