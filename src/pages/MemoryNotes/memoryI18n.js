/* Traducción de las memorias (editor y motor).
   El editor fija aquí el traductor de la app (useT) en cada render; el motor y
   las partes del editor que no son componentes lo usan con L(clave, texto, vars).
   El texto en español es la reserva si falta la clave. Los {marcadores} se
   rellenan con vars. */
let tr = (key, es) => es;
export function setMemoryT(fn) {
  tr = typeof fn === "function" ? fn : (key, es) => es;
}
export function L(key, es, vars) {
  const s = String(tr(key, es) ?? es);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s;
}
