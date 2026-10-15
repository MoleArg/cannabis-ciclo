# Pendientes

## Vista 3D: no se ve el render (oculta)

El interruptor **2D / 3D** del simulador está oculto (`SHOW_3D = false` en `index.html`; la
tecla V también queda desactivada). Al pasar a 3D el `iframe` con `indoor.html?embed` no muestra
la carpa: la escena queda vacía. Todavía no se buscó la causa. Para retomarlo:

1. Abrir `indoor.html` solo y ver si renderiza (descarta Three.js / WebGL).
2. Abrir `indoor.html?embed` solo: en modo embebido espera mensajes `ready`/`state` del simulador.
3. Revisar el handshake `indoorMessage` / `indoorPost` en `index.html` (el simulador manda
   `enter` solo después de recibir `ready`).
4. Al arreglarlo: `SHOW_3D = true` y sacar la clase `hidden` de `#viewSeg`.

## Idea: equipamiento de interior y carpas cargadas por el usuario

En **Clima**, para interior: aire acondicionado, ventiladores, extractor, filtro de carbón activado,
humidificador/deshumidificador, cada uno con su efecto en temperatura, HR, VPD, olor y CO₂.

Va de la mano con la vista 3D: la idea es poder cargar fotos o un video de un indoor o de un
exterior real, que se aplique a la escena y simular con ese espacio. Queda para después de
arreglar el 3D.
