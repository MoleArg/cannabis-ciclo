# Ciclo de vida del cannabis — simulador y guía interactiva

Plataforma web para aprender el ciclo de vida del cannabis jugando con las variables: luz, aire,
agua, humedad, nutrientes, pH, podas, plagas, enfermedades, productos y químicos. La planta
reacciona en tiempo real, en interior (una carpa) o en exterior (sol y clima según lugar y fecha).

**▶ Usar online:** https://molearg.github.io/cannabis-ciclo/

## Cómo se usa el simulador

1. Al entrar está en pausa, en **exterior**, con el mes y la hora reales (el cielo coincide con el
   del momento).
2. En **Ajustes → Planta y modo de cultivo** elegís genética, quimiotipo, semilla, sustrato y dónde
   cultivar. Antes de plantar, cada cambio se ve enseguida.
3. **🌱 Plantar** arranca el tiempo. Con la planta en marcha, los cambios de "Planta y modo de
   cultivo" quedan pendientes (no se pierde la planta actual) y se aplican todos juntos con
   **Plantar de nuevo con esta configuración**.
4. El resto de los grupos de Ajustes (luz, clima, agua, nutrición, sanidad, podas) cambian la
   planta actual al instante. El piloto automático cuida lo que no toques.

Las combinaciones que no existen en la práctica se bloquean: una autofloreciente es siempre
feminizada y de semilla (no se clona). La maceta tiene un tope realista: lo que entra en la carpa
(25 L en 60 × 60, 45 L en 80 × 80, 70 L en 100 × 100, unos 100 L en 120 × 120) o 200 L en exterior.

## Qué tiene

| Pestaña | Contenido |
|---|---|
| Simulador | Paso de 1 hora simulada, controles con bandas de valores ideales por etapa, piloto automático por variable, 17 escenarios para aprender. Abajo, en un panel de altura fija: diagnóstico en vivo, qué limita el crecimiento (ley de Liebig), nutrientes y riesgos, historial y bitácora. Cosecha con informe, secado y curado. |
| Escena 2D | La planta a escala real, en centímetros: en interior entra la carpa entera (pared de mylar, parantes, ventilador de pinza, filtro de carbón, lámpara a su altura); en exterior, cielo con sol por hora y latitud, nubes, lluvia y noche. Compuesta en la GPU (WebGL2): haz de luz que se corta con las hojas, polvo en suspensión, sombras, humedad y calor. La **lupa** (activa por defecto) amplía la planta mientras es chica y en floración muestra los tricomas. Sin WebGL2 (o con `?legacy2d`) vuelve al dibujo anterior. |
| Escena 3D | **Oculta por ahora** (ver `PENDIENTES.md`). Muestra la misma planta en la carpa Cultivarg 80 × 80 × 160 o en un patio, con microscopio que va del cogollo a la molécula. |
| Ciclo de vida | Etapas con duración, necesidades, riesgos y consejos; línea de tiempo por genética; fotoperíodo y fitocromo; sexo; autoflorecientes. |
| Laboratorio | Barril de Liebig, tabla de VPD (clic = aplicar al simulador), pH vs. disponibilidad de nutrientes, luz/CO₂/DLI, temperatura (fotosíntesis vs. respiración). |
| Productos y químicos | Fertilizantes, aditivos, enmiendas, microorganismos, fitosanitarios, PGR y prohibidos, con semáforo de seguridad; cómo actúan los químicos; orden de mezcla; mitos. |
| Diagnóstico | Asistente síntoma → causa. Carencias y excesos con hoja ilustrada; plagas, enfermedades y carencias con fotos reales (para calcio, azufre, exceso de nitrógeno y HLVd no hay fotos libres que sirvan y queda solo el dibujo). |
| Técnicas | Topping, FIM, LST, supercropping, SCROG, SOG, defoliación, lollipop, esquejes y trasplante, cada una con un dibujo animado del corte o del doblado. |
| Cosecha y curado | Microscopio de tricomas animado (60×, tres planos de foco) según el día de floración; tarjetas animadas de cada paso; simulador de secado y curado, con cada cuántos días, cuántos minutos y durante cuántas semanas se abren los frascos. |
| Fuentes | Bibliografía (DOI verificados), glosario y marco legal. |

## Modelo (resumen)

La simulación corre cada hora: clima (interior o exterior con día, sol, lluvia y temperatura según
latitud y fecha), fotosíntesis por capas de hojas (luz, CO₂, temperatura, estomas), respiración,
reparto de materia seca, balance de agua de la maceta, química de la zona de raíces (sales por
elemento, EC, pH, amortiguación del sustrato, materia orgánica y microbios), absorción de N, P, K, Ca,
Mg, S y de los micros Fe, Mn, Zn, Cu, B y Mo según el pH (con antagonismos y toxicidad de micros),
sustrato armado por componentes (turba, coco, perlita, compost, humus, etc.) con sus propiedades
físicas y químicas, fertilización foliar, estreses, plagas y enfermedades (crecimiento logístico, depredadores y
tratamientos), estructura visual de la planta (nudos, hojas, ramas, cogollos) y calidad en floración.

Está calibrado para dar órdenes de magnitud razonables: **es didáctico, no predictivo**.

## Desarrollo

```sh
corepack pnpm install
corepack pnpm dev                                   # desarrollo
corepack pnpm build && corepack pnpm preview        # versión compilada (puerto 4640)
```

### Publicación

Cada push a `main` corre `.github/workflows/pages.yml`, que compila y publica `dist/` en GitHub Pages.
En *Settings → Pages* la fuente tiene que ser **GitHub Actions**. Con "Deploy from a branch" se
publican los archivos sin compilar y se rompen tres cosas: las fotos de `public/` (404), la escena
2D (cae al dibujo anterior) y la vista 3D.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La plataforma: simulador y guía. El simulador y las pestañas son un script en línea, sin dependencias. |
| `src/scene2d/` | La escena 2D en WebGL2: `renderer.js` (luz, cámara, animaciones) y `shader.js` (fondo de carpa o cielo, haz de luz, sombras). |
| `public/plagas/`, `public/diag/` | Fotos de plagas, enfermedades y carencias de Wikimedia Commons y Flickr, solo con licencias libres (CC0, dominio público, CC BY, CC BY-SA). Autor, licencia y planta de origen están en `PEST_PHOTOS` y `DIAG_PHOTOS` (dentro de `index.html`) y se muestran al pie de cada foto. |
| `indoor.html`, `src/indoor/` | La carpa Cultivarg 80 × 80 × 160 en 3D (Three.js + Anime.js). Abierta sola funciona por su cuenta; con `?embed` es la vista 3D del simulador. |
| `PENDIENTES.md` | Lo que queda anotado: probar el 3D embebido y la idea de equipamiento de interior (aire acondicionado, ventiladores, filtro de carbón, carpas cargadas con fotos o video). |
| `index.min.html`, `canvas.html` | Versión anterior del simulador solo (sin 3D ni los cambios recientes), minificada y comprimida para incrustar donde hay límite de tamaño, como el canvas de Paseo. **Desactualizadas.** |
