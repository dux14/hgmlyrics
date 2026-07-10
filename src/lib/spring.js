/**
 * Spring fisico interrumpible, sin DOM ni rAF: el consumidor llama step(dt)
 * en su propio loop de animacion. Pensado para animar translateY del rollo
 * de letra en la vista inmersiva (retarget continuo sin teleport).
 *
 * Integracion semi-implicita de Euler (estable y barata):
 *   v += (-k*(x-target) - c*v) / m * dt
 *   x += v*dt
 */
export function createSpring({ stiffness = 170, damping = 26, precision = 0.01 } = {}) {
  const mass = 1;
  let value = 0;
  let target = 0;
  let velocity = 0;

  return {
    setTarget(v) {
      target = v;
    },

    getValue() {
      return value;
    },

    /**
     * Avanza la simulacion dt milisegundos. Devuelve true si sigue en
     * movimiento, false si llego a reposo (y deja el valor exacto en target).
     */
    step(dtMs) {
      const dt = Math.min(dtMs, 64) / 1000;
      const displacement = value - target;
      const springForce = -stiffness * displacement;
      const dampingForce = -damping * velocity;
      const acceleration = (springForce + dampingForce) / mass;

      velocity += acceleration * dt;
      value += velocity * dt;

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
      value = v;
      target = v;
      velocity = 0;
    },
  };
}
