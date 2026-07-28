/**
 * Spring fisico interrumpible, sin DOM ni rAF: el consumidor llama step(dt)
 * en su propio loop de animacion. Pensado para animar translateY del rollo
 * de letra en la vista inmersiva (retarget continuo sin teleport).
 *
 * Integracion semi-implicita de Euler (estable y barata):
 *   v += (-k*(x-target) - c*v) / m * dt
 *   x += v*dt
 */
// Un solo paso grande (p.ej. 64ms con stiffness/damping altos) cae del lado
// inestable del limite de Euler semi-implicito y diverge; trocear en
// sub-pasos fijos mantiene la simulacion acotada aunque el frame venga lento
// (tab throttled, dispositivo a ~15fps).
const MAX_DT_MS = 64;
const SUBSTEP_MS = 16;

export function createSpring({ stiffness = 170, damping = 26, precision = 0.01 } = {}) {
  const mass = 1;
  let value = 0;
  let target = 0;
  let velocity = 0;

  /** Un sub-paso de Euler semi-implicito con dt fijo (segundos). */
  function integrate(dt) {
    const displacement = value - target;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * velocity;
    const acceleration = (springForce + dampingForce) / mass;

    velocity += acceleration * dt;
    value += velocity * dt;
  }

  return {
    setTarget(v) {
      if (!Number.isFinite(v)) return;
      target = v;
    },

    getValue() {
      return value;
    },

    /**
     * Avanza la simulacion dt milisegundos. Devuelve true si sigue en
     * movimiento, false si llego a reposo (y deja el valor exacto en target).
     * dt se clampa a [0, MAX_DT_MS] y se integra en sub-pasos de SUBSTEP_MS.
     */
    step(dtMs) {
      let remainingMs = Math.min(Math.max(dtMs, 0), MAX_DT_MS);
      while (remainingMs > 0) {
        const subMs = Math.min(remainingMs, SUBSTEP_MS);
        integrate(subMs / 1000);
        remainingMs -= subMs;
      }

      const atRest = Math.abs(velocity) < precision && Math.abs(value - target) < precision;
      if (atRest) {
        value = target;
        velocity = 0;
        return false;
      }
      return true;
    },

    /** Salto instantaneo sin animacion: fija valor y target, velocidad 0. */
    snap(v) {
      if (!Number.isFinite(v)) return;
      value = v;
      target = v;
      velocity = 0;
    },
  };
}
