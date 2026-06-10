/**
 * voiceMesh.js — Gestion de RTCPeerConnections en malla full-mesh por zona.
 *
 * Coordina la apertura y cierre de conexiones WebRTC entre todos los pares
 * presentes en una zona. La regla de quién ofrece se delega a shouldOffer
 * para evitar glare; el calculo del delta de peers se delega a diffPeers.
 *
 * Supuesto documentado: si getLocalStream() retorna null en el momento de
 * conectar, se crea el RTCPeerConnection sin agregar tracks locales. La
 * renegociacion al obtener el stream mas tarde queda fuera del alcance de
 * esta version (se tratara en la tarea A2).
 *
 * Uso:
 *   import { createVoiceMesh } from './voiceMesh.js';
 *
 *   const mesh = createVoiceMesh({ signaling, getLocalStream, iceServers, selfId });
 *   mesh.onRemoteStream((peerId, stream) => { ... });
 *   mesh.onPeerSpeaking((peerId, speaking) => { ... });
 *   mesh.setPeers(['uid-alice', 'uid-bob']);
 *   // Al salir de la zona:
 *   mesh.closeAll();
 */

/* global RTCPeerConnection */

import { shouldOffer } from './voiceGlare.js';
import { diffPeers } from './peerSetDiff.js';

/**
 * @typedef {{
 *   pc:        RTCPeerConnection,
 *   stream:    MediaStream | null,
 *   iceBuffer: RTCIceCandidate[],
 * }} PeerEntry
 */

/**
 * Crea la malla full-mesh de RTCPeerConnections para una zona.
 *
 * @param {{
 *   signaling:      { sendSignal: Function, onSignal: Function },
 *   getLocalStream: () => MediaStream | null,
 *   iceServers:     RTCIceServer[],
 *   selfId:         string,
 * }} opts
 *
 * @returns {{
 *   setPeers:       (peerIdList: string[]) => void,
 *   onRemoteStream: (cb: (peerId: string, stream: MediaStream) => void) => void,
 *   onPeerSpeaking: (cb: (peerId: string, speaking: boolean) => void) => void,
 *   closeAll:       () => void,
 * }}
 */
export function createVoiceMesh({ signaling, getLocalStream, iceServers, selfId }) {
  /** @type {Map<string, PeerEntry>} */
  const peers = new Map();

  /** Conjunto de peer ids que se esperan en la zona actual (excluye selfId). */
  let expectedPeers = new Set();

  /** @type {((peerId: string, stream: MediaStream) => void) | null} */
  let _onRemoteStream = null;

  // Almacenado para uso en la tarea A2 (analisis de nivel de audio / RMS).
  // eslint-disable-next-line no-unused-vars
  let _onPeerSpeaking = null;

  // -------------------------------------------------------------------------
  // Señalizacion entrante — un unico handler para toda la malla
  // -------------------------------------------------------------------------

  signaling.onSignal(async ({ fromUid, type, payload }) => {
    if (type === 'offer') {
      // Ignorar ofertas de peers que ya no esperamos y que no estan en la malla,
      // para evitar crear RTCPeerConnections huerfanas por mensajes tardios.
      if (!peers.has(fromUid) && !expectedPeers.has(fromUid)) return;

      // Recibimos una oferta: somos el respondedor (answerer)
      const entry = getOrCreatePeer(fromUid, /* isAnswerer */ true);
      try {
        await entry.pc.setRemoteDescription(payload);
        drainIceBuffer(fromUid, entry);
        const answer = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(answer);
        signaling.sendSignal(fromUid, { type: 'answer', payload: answer });
      } catch (err) {
        console.error('[voiceMesh] Error procesando offer de', fromUid, err);
      }
    } else if (type === 'answer') {
      // Recibimos respuesta a nuestra oferta
      const entry = peers.get(fromUid);
      if (!entry) return;
      try {
        await entry.pc.setRemoteDescription(payload);
        drainIceBuffer(fromUid, entry);
      } catch (err) {
        console.error('[voiceMesh] Error procesando answer de', fromUid, err);
      }
    } else if (type === 'ice') {
      // Candidato ICE entrante
      const entry = peers.get(fromUid);
      if (!entry) return;
      if (entry.pc.remoteDescription) {
        try {
          await entry.pc.addIceCandidate(payload);
        } catch (err) {
          console.error('[voiceMesh] Error agregando ICE candidate de', fromUid, err);
        }
      } else {
        // Aun no tenemos remoteDescription; bufferizar
        entry.iceBuffer.push(payload);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Helpers internos
  // -------------------------------------------------------------------------

  /**
   * Retorna la entrada existente para peerId o crea una nueva.
   * Cuando isAnswerer=true, NO se envia oferta (el remoto ya nos ofrecio).
   *
   * @param {string}  peerId
   * @param {boolean} [isAnswerer=false]
   * @returns {PeerEntry}
   */
  function getOrCreatePeer(peerId, isAnswerer = false) {
    if (peers.has(peerId)) return peers.get(peerId);

    const pc = new RTCPeerConnection({ iceServers });

    /** @type {PeerEntry} */
    const entry = { pc, stream: null, iceBuffer: [] };
    peers.set(peerId, entry);

    // Agregar tracks del stream local si ya esta disponible
    const localStream = getLocalStream();
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }
    // Nota: si localStream es null, la conexion se crea sin tracks locales.
    // La renegociacion al obtener el stream queda fuera del alcance de esta version.

    // Monitorear el estado de la conexión para medir la tasa de fallos P2P.
    // En producción, estos logs permiten decidir si se necesita TURN.
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed') {
        console.warn(
          '[voz] peer=' +
            peerId +
            ' connectionState=failed — posible NAT simétrico; considerar TURN',
        );
      } else if (state === 'disconnected') {
        console.warn('[voz] peer=' + peerId + ' connectionState=disconnected');
      }
    };

    // Enviar candidatos ICE al par remoto en cuanto esten disponibles
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        signaling.sendSignal(peerId, { type: 'ice', payload: candidate });
      }
    };

    // Recibir track remoto
    pc.ontrack = ({ streams }) => {
      const remoteStream = streams[0] ?? null;
      entry.stream = remoteStream;
      if (remoteStream && _onRemoteStream) {
        _onRemoteStream(peerId, remoteStream);
      }
    };

    // Si somos el oferente (determinado por shouldOffer), enviamos la oferta
    if (!isAnswerer && shouldOffer(selfId, peerId)) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => {
          // Verificar que el peer siga activo antes de enviar: el teardown pudo
          // haber ocurrido mientras la promesa estaba en vuelo.
          const current = peers.get(peerId);
          if (!current || current.pc !== pc || pc.signalingState === 'closed') return;
          signaling.sendSignal(peerId, { type: 'offer', payload: offer });
        })
        .catch((err) => {
          console.error('[voiceMesh] Error creando offer para', peerId, err);
        });
    }

    return entry;
  }

  /**
   * Aplica todos los candidatos ICE que habian llegado antes que remoteDescription.
   *
   * @param {string}    peerId
   * @param {PeerEntry} entry
   */
  function drainIceBuffer(peerId, entry) {
    const buffered = entry.iceBuffer.splice(0);
    buffered.forEach((candidate) => {
      entry.pc.addIceCandidate(candidate).catch((err) => {
        console.error('[voiceMesh] Error drenando ICE candidate de', peerId, err);
      });
    });
  }

  /**
   * Cierra y elimina la conexion de un peer concreto.
   *
   * @param {string} peerId
   */
  function teardownPeer(peerId) {
    const entry = peers.get(peerId);
    if (!entry) return;
    entry.pc.close();
    entry.stream = null;
    entry.iceBuffer = [];
    peers.delete(peerId);
  }

  // -------------------------------------------------------------------------
  // Interfaz publica
  // -------------------------------------------------------------------------

  /**
   * Actualiza el conjunto de peers conectados.
   * Abre conexiones para los nuevos y cierra las de los que ya no estan.
   *
   * @param {string[]} peerIdList - Lista de peer ids que deben estar conectados.
   */
  function setPeers(peerIdList) {
    // Actualizar el conjunto esperado antes de computar el delta, para que la
    // guardia de la oferta entrante ya refleje la nueva lista desde este momento.
    expectedPeers = new Set(peerIdList.filter((id) => id !== selfId));

    const { toAdd, toRemove } = diffPeers([...peers.keys()], peerIdList, selfId);

    toAdd.forEach((peerId) => getOrCreatePeer(peerId));
    toRemove.forEach((peerId) => teardownPeer(peerId));
  }

  /**
   * Registra el callback que se invoca cuando llega un stream de audio remoto.
   *
   * @param {(peerId: string, stream: MediaStream) => void} cb
   */
  function onRemoteStream(cb) {
    _onRemoteStream = cb;
  }

  /**
   * Registra el callback para cambios de estado de voz activa de un peer.
   * El analisis de nivel de audio (AnalyserNode/RMS) se implementa en la tarea A2.
   *
   * @param {(peerId: string, speaking: boolean) => void} cb
   */
  function onPeerSpeaking(cb) {
    _onPeerSpeaking = cb;
  }

  /**
   * Cierra todas las RTCPeerConnections y detiene los tracks del stream local.
   */
  function closeAll() {
    // Snapshot de claves para evitar iterar sobre el Map mientras se muta.
    [...peers.keys()].forEach((peerId) => teardownPeer(peerId));

    // Detener tracks del stream local
    getLocalStream()
      ?.getTracks()
      .forEach((t) => t.stop());
  }

  return { setPeers, onRemoteStream, onPeerSpeaking, closeAll };
}
