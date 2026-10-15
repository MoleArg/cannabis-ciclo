# Pendientes

## Vista 3D: no se ve el render (oculta)

El interruptor **2D / 3D** del simulador está oculto (`SHOW_3D = false` en `index.html`; la
tecla V también queda desactivada).

**Causa probable (2026-10-15):** Pages estaba en "Deploy from a branch" y publicaba los archivos
crudos de `main`: `indoor.html` sin compilar no puede importar Three.js y `index.html` pedía
`/src/scene2d/index.js` (404). Al pasar Pages a "GitHub Actions", `indoor.html` publicado carga
sin errores y renderiza la carpa. Falta probar el 3D embebido en el simulador:

1. Poner `SHOW_3D = true` y sacar la clase `hidden` de `#viewSeg`.
2. Probar en https://molearg.github.io/cannabis-ciclo/ el paso 2D → 3D y el regreso.
3. Si el `iframe` sigue vacío, revisar el handshake `indoorMessage` / `indoorPost`
   (el simulador manda `enter` solo después de recibir `ready`).

## Idea: equipamiento de interior y carpas cargadas por el usuario

En **Clima**, para interior: aire acondicionado, ventiladores, extractor, filtro de carbón activado,
humidificador/deshumidificador, cada uno con su efecto en temperatura, HR, VPD, olor y CO₂.

Va de la mano con la vista 3D: la idea es poder cargar fotos o un video de un indoor o de un
exterior real, que se aplique a la escena y simular con ese espacio. Queda para después de
arreglar el 3D.
