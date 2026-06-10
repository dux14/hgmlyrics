import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZoneChat, prepareMessage } from '../../src/components/ZoneChat.js';

// ── prepareMessage (función pura) ────────────────────────────────────────────

describe('prepareMessage', () => {
  it('retorna ok:true con el texto recortado en los extremos', () => {
    expect(prepareMessage('  hola  ')).toEqual({ ok: true, text: 'hola' });
  });

  it('retorna ok:false con cadena vacía', () => {
    expect(prepareMessage('')).toEqual({ ok: false });
  });

  it('retorna ok:false con solo espacios', () => {
    expect(prepareMessage('   ')).toEqual({ ok: false });
  });

  it('recorta texto que supera maxLen a exactamente maxLen caracteres', () => {
    const long = 'a'.repeat(300);
    const result = prepareMessage(long);
    expect(result.ok).toBe(true);
    expect(result.text.length).toBe(280);
  });

  it('respeta un maxLen personalizado', () => {
    const result = prepareMessage('abcde', { maxLen: 3 });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('abc');
  });
});

// ── ZoneChat (componente DOM) ─────────────────────────────────────────────────

describe('ZoneChat', () => {
  let chat;

  beforeEach(() => {
    chat = ZoneChat();
    document.body.appendChild(chat.el);
  });

  // Limpieza de DOM entre tests
  afterEach(() => {
    chat.el.remove();
  });

  // 1. El contenedor arranca oculto
  it('el arranca oculto (display:none)', () => {
    expect(chat.el.style.display).toBe('none');
  });

  // 2. setZone con zona válida
  it('setZone({name,channelId}) muestra el overlay y pone el nombre en el header', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    expect(chat.el.style.display).not.toBe('none');
    expect(chat.el.textContent).toContain('Plaza');
  });

  // 3. Cambiar de zona limpia los mensajes anteriores
  it('llamar setZone con otra zona limpia la lista de mensajes', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    chat.addMessage({ name: 'Ana', text: 'Hola' });
    chat.addMessage({ name: 'Bob', text: 'Hey' });

    chat.setZone({ name: 'Bosque', channelId: 'bosque' });

    // El header ahora muestra la nueva zona
    expect(chat.el.textContent).toContain('Bosque');
    // No quedan mensajes de la zona anterior
    expect(chat.el.textContent).not.toContain('Hola');
    expect(chat.el.textContent).not.toContain('Hey');
  });

  // 4. setZone(null) oculta y limpia
  it('setZone(null) oculta el overlay y limpia mensajes', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    chat.addMessage({ name: 'Ana', text: 'Hola' });

    chat.setZone(null);

    expect(chat.el.style.display).toBe('none');
    expect(chat.el.textContent).not.toContain('Hola');
  });

  // 5. addMessage es XSS-safe: HTML no se interpreta como DOM
  it('addMessage no interpreta HTML como markup (XSS-safe)', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    const xssName = '<script>alert(1)</script>';
    const xssText = '<img src=x onerror=alert(1)>';
    chat.addMessage({ name: xssName, text: xssText });

    // No hay ningún elemento <img> ni <script> real en el DOM
    expect(chat.el.querySelector('img')).toBeNull();
    expect(chat.el.querySelector('script')).toBeNull();

    // El texto literal sí está presente en el textContent del overlay
    expect(chat.el.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(chat.el.textContent).toContain('<script>alert(1)</script>');
  });

  // 6. onSend: texto válido dispara callback; texto vacío no
  it('onSend: Enter con texto válido dispara el callback', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    const cb = vi.fn();
    chat.onSend(cb);

    const input = chat.el.querySelector('input');
    input.value = 'Hola mundo';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('Hola mundo');
  });

  it('onSend: Enter con texto vacío no dispara el callback', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    const cb = vi.fn();
    chat.onSend(cb);

    const input = chat.el.querySelector('input');
    input.value = '   ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(cb).not.toHaveBeenCalled();
  });

  it('onSend: el input queda vacío tras un envío exitoso', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    chat.onSend(() => {});

    const input = chat.el.querySelector('input');
    input.value = 'Mensaje';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(input.value).toBe('');
  });

  // 7. Anti-spam: dos envíos consecutivos inmediatos → el segundo se descarta
  it('anti-spam: segundo envío dentro de 700 ms se descarta', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    const cb = vi.fn();
    chat.onSend(cb);

    const input = chat.el.querySelector('input');

    // Primer envío en t=1000
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
    input.value = 'Primero';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1);

    // Segundo envío en t=1500 (solo 500 ms después, < 700 ms)
    dateSpy.mockReturnValue(1500);
    input.value = 'Segundo';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(1); // descartado

    // Tercer envío en t=1800 (800 ms desde el primero, ≥ 700 ms)
    dateSpy.mockReturnValue(1800);
    input.value = 'Tercero';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(cb).toHaveBeenCalledTimes(2); // pasa

    dateSpy.mockRestore();
  });

  it('anti-spam: después de ≥ 700 ms el envío pasa normalmente', () => {
    chat.setZone({ name: 'Plaza', channelId: 'plaza' });
    const cb = vi.fn();
    chat.onSend(cb);

    const input = chat.el.querySelector('input');

    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(0);
    input.value = 'A';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    dateSpy.mockReturnValue(700); // exactamente el intervalo
    input.value = 'B';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(cb).toHaveBeenCalledTimes(2);
    dateSpy.mockRestore();
  });
});
