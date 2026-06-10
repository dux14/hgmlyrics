/**
 * Calcula el delta entre el conjunto de peers actual y el siguiente.
 */

/**
 * Compara dos conjuntos de peer ids y devuelve los que deben agregarse
 * y los que deben eliminarse para pasar de `current` a `next`.
 * El id de `self` (usuario local) queda excluido de ambas listas de forma
 * defensiva, incluso si aparece en alguno de los arrays de entrada.
 *
 * @param {string[]|Set<string>} current - Peer ids con conexión activa actualmente.
 * @param {string[]|Set<string>} next    - Peer ids que deben estar conectados.
 * @param {string}               self    - Id del usuario local; nunca se incluye en el resultado.
 * @returns {{ toAdd: string[], toRemove: string[] }}
 */
export function diffPeers(current, next, self) {
  const currentSet = new Set(current);
  const nextSet = new Set(next);

  // Eliminar self de ambos conjuntos antes de calcular el delta.
  currentSet.delete(self);
  nextSet.delete(self);

  // toAdd: están en next pero no en current (preserva el orden de next).
  const toAdd = [...nextSet].filter((id) => !currentSet.has(id));

  // toRemove: están en current pero no en next (preserva el orden de current).
  const toRemove = [...currentSet].filter((id) => !nextSet.has(id));

  return { toAdd, toRemove };
}
