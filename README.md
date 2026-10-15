# Ciclo de vida del cannabis — simulador, guía e indoor 3D

Plataforma web para aprender el ciclo de vida
del cannabis jugando con las variables: luz, aire, agua, humedad, nutrientes, pH, podas, plagas,
enfermedades, productos y químicos. La planta reacciona en tiempo real y se ve también dentro de una carpa en 3D.

**▶ Usar online:** https://molearg.github.io/cannabis-ciclo/

## Desarrollo

```sh
corepack pnpm install
corepack pnpm dev                                   # desarrollo
corepack pnpm build && corepack pnpm preview        # versión compilada (puerto 4640)
```

GitHub Pages publica `dist/` con `.github/workflows/pages.yml` (en *Settings → Pages* la fuente tiene
que ser **GitHub Actions**).

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La plataforma: simulador (con su escena en 2D o en 3D) y guía. El simulador sigue siendo un script en línea, sin dependencias. |
| `public/plagas/`, `public/diag/` | Fotos de plagas, enfermedades y carencias (Wikimedia Commons; autor y licencia en `PEST_PHOTOS` y `DIAG_PHOTOS`, dentro de `index.html`). |
| `PENDIENTES.md` | Lo que queda anotado: el 3D que no renderiza y la idea de equipamiento de interior. |
| `indoor.html`, `src/indoor/` | La carpa Cultivarg 80 × 80 × 160 en 3D (Three.js + Anime.js). Abierta sola funciona como antes; con `?embed` es la vista 3D de la escena del simulador. |
| `index.min.html` | El simulador solo (sin 3D), minificado y autocontenido. |
| `canvas.html` | El simulador solo, comprimido (gzip + base64, < 200 000 caracteres) para incrustar donde hay límite de tamaño, como una ventana del canvas de Paseo. |

## Qué tiene

| Pestaña | Contenido |
|---|---|
| Simulador | Arranca en pausa, en exterior y con la hora real: el tiempo corre al tocar **Plantar**. Los cambios de "Planta y modo de cultivo" se juntan y se aplican con "Plantar de nuevo con esta configuración"; las combinaciones que no existen se bloquean (una auto es siempre feminizada y de semilla). La escena está a escala real (en interior entra la carpa entera) y la lupa amplía la planta mientras es chica. La maceta tiene un tope realista: lo que entra en la carpa o 200 L en exterior. Planta dibujada en canvas, paso de 1 hora simulada, controles con bandas de valores ideales por etapa, piloto automático por variable, diagnóstico en vivo, factores limitantes (ley de Liebig), historial, bitácora, cosecha, secado y curado, 17 escenarios. |
| Escena 2D | La planta dibujada con la lógica de síntomas, plagas y raíces, compuesta en la GPU (WebGL2): mylar, haz de luz que se corta con las hojas, polvo en suspensión, sombras, bloom, cielo con nubes, sol y lluvia en exterior, humedad, calor y noche. Animaciones con anime.js: encendido del LED, riego, cambio de etapa, planta nueva. A muchos días por segundo el día y la noche se promedian (timelapse) en vez de parpadear. Sin WebGL2 (o con `?legacy2d`) vuelve al dibujo anterior. |
| Escena 3D | **Oculta por ahora** (no se ve el render; ver `PENDIENTES.md`). El interruptor 2D / 3D muestra la misma planta en la carpa Cultivarg 80 × 80 × 160 o en un patio. |
| Microscopio (🔬 o tecla Z en 3D) | Zoom continuo del cogollo al átomo: cálices, pistilos y miles de tricomas → bosque de tricomas capitados → resina con THC/CBD/CBN → la molécula real (coordenadas 3D de PubChem) → un átomo de carbono con núcleo y orbitales. Los colores de tricomas, pistilos y la molécula salen del estado del simulador. |
| Ciclo de vida | Etapas con duración, necesidades, riesgos y consejos; línea de tiempo por genética; fotoperíodo y fitocromo; sexo; autoflorecientes. |
| Laboratorio | Barril de Liebig, tabla de VPD (clic = aplicar al simulador), pH vs. disponibilidad de nutrientes, luz/CO₂/DLI, temperatura (fotosíntesis vs. respiración). |
| Productos y químicos | Fertilizantes, aditivos, enmiendas, microorganismos, fitosanitarios, PGR y prohibidos, con semáforo de seguridad; cómo actúan los químicos; orden de mezcla; mitos. |
| Diagnóstico | Asistente síntoma → causa; carencias y excesos con hojas ilustradas; plagas, enfermedades y carencias con fotos reales de Wikimedia Commons (crédito, licencia y planta de origen al pie; para P, Ca, S y HLVd no hay fotos libres y queda el dibujo). |
| Técnicas | Topping, FIM, LST, supercropping, SCROG, SOG, defoliación, lollipop, esquejes, trasplante, cada una con un dibujo animado del corte o del doblado. |
| Cosecha y curado | Microscopio de tricomas animado (60×, tres planos de foco) por día de floración; tarjetas con animaciones de cada paso; simulador de secado y curado (cada cuántos días, cuántos minutos y durante cuántas semanas se abren los frascos). |
| Fuentes | Bibliografía (DOI verificados), glosario y marco legal. |

## Modelo (resumen)

La simulación corre cada hora: clima (interior o exterior con día, sol, lluvia y temperatura según
latitud y fecha), fotosíntesis por capas de hojas (luz, CO₂, temperatura, estomas), respiración,
reparto de materia seca, balance de agua de la maceta, química de la zona de raíces (sales por
elemento, EC, pH, amortiguación del sustrato, materia orgánica y microbios), absorción de N, P, K, Ca,
Mg, S y Fe según el pH, estreses, plagas y enfermedades (crecimiento logístico, depredadores y
tratamientos), estructura visual de la planta (nudos, hojas, ramas, cogollos) y calidad en floración.

Está calibrado para dar órdenes de magnitud razonables: **es didáctico, no predictivo**.
