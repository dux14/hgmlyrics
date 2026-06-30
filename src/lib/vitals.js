import { onINP, onLCP, onCLS } from 'web-vitals/attribution';

function send(metric) {
  const attr = metric.attribution ?? {};
  // interactionTarget (INP) y element (LCP/CLS) son selectores CSS (strings en v5)
  const target = attr.interactionTarget ?? attr.element ?? attr.largestShiftTarget ?? null;
  const body = JSON.stringify({
    metric: metric.name,
    value: metric.value,
    rating: metric.rating,
    navigationType: metric.navigationType,
    path: location.pathname,
    attribution: target ? { target: String(target) } : null,
  });
  navigator.sendBeacon?.('/api/vitals', body);
}

export function initVitals() {
  onINP(send);
  onLCP(send);
  onCLS(send);
}
