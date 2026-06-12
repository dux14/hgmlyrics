# Auditoría de licencias — Modelos de ML del Estudio (4 secciones)

> **Nota de monetización:** La app HKN Lyrics no está monetizada, por lo que las
> licencias NonCommercial (NC) son **aceptables en el estado actual**.
> Si la app se monetiza en el futuro, **S4 queda BLOQUEADA**: el modelo
> `chorus_bs_roformer` (Sucial) es CC-BY-NC-SA-4.0 y no permite uso comercial.
> La alternativa `bs_roformer_male_female_by_aufr33` tiene licencia **sin confirmar**
> (ver sección S4).

---

## S1 — voiceInstrumental

### Modelo: BS-RoFormer ep_317

| Campo | Valor |
|---|---|
| Checkpoint | `model_bs_roformer_ep_317_sdr_12.9755.ckpt` |
| Tarea | Separación vocal / instrumental |
| Framework de entrenamiento | ZFTurbo `Music-Source-Separation-Training` |
| Repo | https://github.com/ZFTurbo/Music-Source-Separation-Training |
| Licencia del framework | MIT |
| Licencia del checkpoint | MIT (entrenado con framework MIT; sin restricciones propias del checkpoint) |
| Uso comercial | Permitido |
| Texto de atribución | BS-RoFormer ep_317 — framework MIT (ZFTurbo) |

**Notas:** El framework MIT de ZFTurbo cubre el entrenamiento y la inferencia. Cada
checkpoint tiene licencia propia; en este caso no se ha identificado restricción adicional
sobre el checkpoint ep_317. Confirmado SOTA y libre/comercial en research previo.

---

### Modelo: Demucs htdemucs_6s

| Campo | Valor |
|---|---|
| Checkpoint | `htdemucs_6s` (integrado en Demucs v4) |
| Tarea | Separación de batería / bajo / guitarra / piano / other / vocales |
| Repo | https://github.com/facebookresearch/demucs |
| Licencia | MIT |
| Uso comercial | Permitido |
| Texto de atribución | Demucs htdemucs_6s (Meta Research) — MIT |

---

## S2 — structure

### Modelo: SongFormer

| Campo | Valor |
|---|---|
| Checkpoint | Pesos en HuggingFace `ASLP-lab/SongFormer` |
| Tarea | Segmentación de estructura musical (intro / verso / coro / puente) |
| Repo | https://github.com/ASLP-lab/SongFormer |
| HuggingFace | https://huggingface.co/ASLP-lab/SongFormer |
| Licencia | **CC-BY-4.0** (verificado vía HuggingFace, jun 2026) |
| Uso comercial | Permitido con atribución |
| Texto de atribución | SongFormer (ASLP-lab) — CC-BY-4.0 |

**Notas:** Autores: Hao, Yuan, Yao, Deng, Bai, Wang, Xue, Xie. Precisión ACC 0.891
(supera All-In-One 0.834). Publicado oct 2025 (arxiv 2510.02797).

---

## S3 — leadBacking

### Modelo: MedleyVox (pesos comunidad — Cyru5)

| Campo | Valor |
|---|---|
| Checkpoint | Pesos comunitarios en `Cyru5/MedleyVox` (HuggingFace) |
| Tarea | Separación lead vocals / backing vocals (multi-singer) |
| Repo código original | https://github.com/jeonchangbin49/MedleyVox |
| HuggingFace pesos | https://huggingface.co/Cyru5/MedleyVox |
| Licencia del código (jeonchangbin49) | **Sin confirmar — VERIFICAR**: el repo GitHub no incluye archivo LICENSE ni badge visible |
| Licencia de los pesos (Cyru5) | **CC-BY-4.0** (verificado vía HuggingFace: "License: cc-by-4.0", autor Carson Evans) |
| Uso comercial | Pesos Cyru5: permitido con atribución. Código base: sin confirmar |
| Texto de atribución | MedleyVox (pesos: Cyru5/Carson Evans, CC-BY-4.0); código base: ICASSP 2023, jeonchangbin49 |

**Notas:** Los pesos que usa el pipeline en producción son los de `Cyru5/MedleyVox`
(CC-BY-4.0, uso comercial OK). El código del repositorio original (jeonchangbin49)
**no tiene licencia explícita publicada** — esto implica que, bajo la ley de copyright
por defecto, todos los derechos estarían reservados. Para uso estricto en producción
comercial sería necesario contactar al autor o confirmar licencia. Para uso no comercial
actual, la ausencia de licencia es un riesgo bajo pero registrado.

---

## S4 — gender

### Modelo: chorus_bs_roformer ep_267 (principal, en uso)

| Campo | Valor |
|---|---|
| Checkpoint | `model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt` |
| Tarea | Separación vocal masculino / femenino directa |
| Autor | Sucial |
| HuggingFace | https://huggingface.co/Sucial/Chorus_Male_Female_BS_Roformer |
| Origen | Fine-tuning de `model_bs_roformer_ep_317` |
| Datos de entrenamiento | opencpop + M4Singer (~750 canciones) |
| Licencia | **CC-BY-NC-SA-4.0** (verificado vía HuggingFace, jun 2026) |
| Uso comercial | **NO PERMITIDO** (NC = NonCommercial) |
| ShareAlike | Sí — derivados deben usar la misma licencia |
| Uso actual (app no monetizada) | Aceptable |
| Texto de atribución | chorus_bs_roformer ep_267 (Sucial) — CC-BY-NC-SA-4.0 · Solo uso no comercial |

---

### Modelo: bs_roformer_male_female (aufr33) — candidato alternativo

| Campo | Valor |
|---|---|
| Checkpoint | `bs_roformer_male_female_by_aufr33_sdr_7.2889.ckpt` |
| Tarea | Separación vocal masculino / femenino |
| Autor | aufr33 |
| HuggingFace | No accesible públicamente (devuelve HTTP 401 sin autenticación) |
| Licencia | **Sin confirmar — VERIFICAR**: no se pudo acceder al repo HuggingFace |
| Uso comercial | Sin confirmar |
| Texto de atribución | (pendiente de verificación de licencia) |

**Notas:** aufr33 es un colaborador activo de la comunidad UVR/ZFTurbo (tiene modelos
MIT en el framework de ZFTurbo para denoise y crowd). El repo específico de
`bs_roformer_male_female` no fue accesible sin autenticación HuggingFace en la
verificación de jun 2026. Si la licencia resulta ser MIT o Apache-2.0, este modelo
sería la alternativa preferida para monetización futura (SDR 7.29 dB, más bajo que
chorus_bs_roformer 24.13 dB, pero sin restricción NC).

---

## Resumen de licencias por modelo

| Modelo | Sección | Licencia | Uso comercial | Estado |
|---|---|---|---|---|
| BS-RoFormer ep_317 | S1 | MIT | Sí | Confirmado |
| Demucs htdemucs_6s | S1 | MIT | Sí | Confirmado |
| SongFormer (ASLP-lab) | S2 | CC-BY-4.0 | Sí (con atribución) | Confirmado |
| MedleyVox pesos (Cyru5) | S3 | CC-BY-4.0 | Sí (con atribución) | Confirmado |
| MedleyVox código (jeonchangbin49) | S3 | Sin licencia explícita | Incierto | Sin confirmar |
| chorus_bs_roformer ep_267 (Sucial) | S4 | CC-BY-NC-SA-4.0 | No | Confirmado |
| bs_roformer_male_female (aufr33) | S4 alt. | Sin confirmar | Sin confirmar | Sin confirmar |

---

## Atribuciones por sección de UI

Estas cadenas son el texto exacto a mostrar en la interfaz del Estudio junto a cada sección:

| Sección | String de atribución |
|---|---|
| **S1 — Voz e Instrumental** | BS-RoFormer ep_317 · MIT · Demucs htdemucs_6s (Meta) · MIT |
| **S2 — Estructura** | SongFormer (ASLP-lab) — CC-BY-4.0 |
| **S3 — Lead / Backing** | MedleyVox (Cyru5 / Carson Evans) — CC-BY-4.0 |
| **S4 — Genero vocal** | chorus_bs_roformer ep_267 (Sucial) — CC-BY-NC-SA-4.0 · Solo uso no comercial |

> **Advertencia de monetizacion:** Si la app se monetiza, S4 requiere reemplazar
> `chorus_bs_roformer` (Sucial, CC-BY-NC-SA-4.0) por un modelo con licencia permisiva.
> Opciones: (a) verificar y usar `bs_roformer_male_female_by_aufr33` si su licencia
> lo permite; (b) re-entrenar un modelo propio sobre el framework MIT de ZFTurbo.

---

## Modelos descartados (referencia)

| Modelo | Razon de descarte |
|---|---|
| allin1 (mir-aidj) | Licencia comercial NO confirmada (claim MIT refutado en investigacion) |
| MossFormer2, SepFormer, TF-GridNet | Domain mismatch severo: entrenados en habla, no en canto |
| UNMIXX | Sin repo publico disponible |

---

*Auditoria realizada: junio 2026. Fuentes: HuggingFace model cards, GitHub repos,
reportes de research internos (2026-06-10, 2026-06-11).*
