# Ciclo de vida del cannabis — simulador y guía interactiva

Página web autocontenida (un solo HTML, sin dependencias ni internet) para aprender el ciclo de vida
del cannabis jugando con las variables: luz, aire, agua, humedad, nutrientes, pH, podas, plagas,
enfermedades, productos y químicos. La planta reacciona en tiempo real.

**▶ Usar online:** https://molearg.github.io/cannabis-ciclo/

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Versión legible. Es la que sirve GitHub Pages. Se abre también con doble clic en cualquier navegador. |
| `index.min.html` | La misma, minificada. |
| `canvas.html` | Cargador comprimido (gzip + base64, < 200 000 caracteres) para incrustar donde hay límite de tamaño, como una ventana del canvas de Paseo. |

## Qué tiene

| Pestaña | Contenido |
|---|---|
| Simulador | Planta dibujada en canvas, paso de 1 hora simulada, controles con bandas de valores ideales por etapa, piloto automático por variable, diagnóstico en vivo, factores limitantes (ley de Liebig), historial, bitácora, cosecha, secado y curado, 17 escenarios. |
| Ciclo de vida | Etapas con duración, necesidades, riesgos y consejos; línea de tiempo por genética; fotoperíodo y fitocromo; sexo; autoflorecientes. |
| Laboratorio | Barril de Liebig, tabla de VPD (clic = aplicar al simulador), pH vs. disponibilidad de nutrientes, luz/CO₂/DLI, temperatura (fotosíntesis vs. respiración). |
| Productos y químicos | Fertilizantes, aditivos, enmiendas, microorganismos, fitosanitarios, PGR y prohibidos, con semáforo de seguridad; cómo actúan los químicos; orden de mezcla; mitos. |
| Diagnóstico | Asistente síntoma → causa; carencias y excesos con hojas ilustradas; plagas y enfermedades. |
| Técnicas | Topping, FIM, LST, supercropping, SCROG, SOG, defoliación, lollipop, esquejes, trasplante. |
| Cosecha y curado | Microscopio de tricomas por día de floración; simulador de secado y curado. |
| Fuentes | Bibliografía (DOI verificados), glosario y marco legal. |

## Modelo (resumen)

La simulación corre cada hora: clima (interior o exterior con día, sol, lluvia y temperatura según
latitud y fecha), fotosíntesis por capas de hojas (luz, CO₂, temperatura, estomas), respiración,
reparto de materia seca, balance de agua de la maceta, química de la zona de raíces (sales por
elemento, EC, pH, amortiguación del sustrato, materia orgánica y microbios), absorción de N, P, K, Ca,
Mg, S y Fe según el pH, estreses, plagas y enfermedades (crecimiento logístico, depredadores y
tratamientos), estructura visual de la planta (nudos, hojas, ramas, cogollos) y calidad en floración.

Está calibrado para dar órdenes de magnitud razonables: **es didáctico, no predictivo**.
